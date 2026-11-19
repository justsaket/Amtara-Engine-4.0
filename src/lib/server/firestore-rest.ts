import { resolveAutonomousConfiguration } from '@/lib/config/manager';
import { AppError } from './error-handler';

type FirestoreValue =
  | { nullValue: null }
  | { booleanValue: boolean }
  | { integerValue: string }
  | { doubleValue: number }
  | { timestampValue: string }
  | { stringValue: string }
  | { arrayValue: { values?: FirestoreValue[] } }
  | { mapValue: { fields?: Record<string, FirestoreValue> } };

interface FirestoreRestDoc {
  name: string;
  fields?: Record<string, FirestoreValue>;
  createTime?: string;
  updateTime?: string;
}

export function encodeFirestoreValue(val: unknown): FirestoreValue {
  if (val === null || val === undefined) return { nullValue: null };
  if (typeof val === 'boolean') return { booleanValue: val };
  if (typeof val === 'number') {
    if (Number.isInteger(val)) return { integerValue: String(val) };
    return { doubleValue: val };
  }
  if (val instanceof Date) return { timestampValue: val.toISOString() };
  if (typeof val === 'string') return { stringValue: val };
  if (Array.isArray(val)) {
    return { arrayValue: { values: val.map(encodeFirestoreValue) } };
  }
  if (typeof val === 'object') {
    const fields: Record<string, FirestoreValue> = {};
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      if (v !== undefined) {
        fields[k] = encodeFirestoreValue(v);
      }
    }
    return { mapValue: { fields } };
  }
  return { stringValue: String(val) };
}

export function decodeFirestoreValue(val: FirestoreValue | undefined): unknown {
  if (!val) return undefined;
  if ('nullValue' in val) return null;
  if ('booleanValue' in val) return val.booleanValue;
  if ('integerValue' in val) return Number(val.integerValue);
  if ('doubleValue' in val) return val.doubleValue;
  if ('timestampValue' in val) return val.timestampValue;
  if ('stringValue' in val) return val.stringValue;
  if ('arrayValue' in val) {
    return (val.arrayValue.values || []).map(decodeFirestoreValue);
  }
  if ('mapValue' in val) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(val.mapValue.fields || {})) {
      out[k] = decodeFirestoreValue(v);
    }
    return out;
  }
  return undefined;
}

export function decodeDocumentFields(doc: FirestoreRestDoc): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(doc.fields || {})) {
    out[k] = decodeFirestoreValue(v);
  }
  return out;
}

export function encodeDocumentFields(
  data: Record<string, unknown>,
): Record<string, FirestoreValue> {
  const fields: Record<string, FirestoreValue> = {};
  for (const [k, v] of Object.entries(data)) {
    if (v !== undefined) {
      fields[k] = encodeFirestoreValue(v);
    }
  }
  return fields;
}

export interface CommitWriteOp {
  path: string;
  data?: Record<string, unknown>;
  updateMask?: string[];
  serverTimestampFields?: string[];
  preconditionExists?: boolean;
  delete?: boolean;
}

export class FirestoreRestClient {
  private readonly projectId: string;
  private readonly databaseId: string;
  private readonly idToken: string;

  constructor(idToken: string) {
    const { snapshot } = resolveAutonomousConfiguration();
    if (!snapshot.firebase.projectId) {
      throw new AppError(
        503,
        'FIRESTORE_UNCONFIGURED',
        'Firebase Project ID is missing in environment and configuration.',
      );
    }
    this.projectId = snapshot.firebase.projectId;
    this.databaseId = snapshot.firebase.databaseId || '(default)';
    this.idToken = idToken;
  }

  private get baseRoot(): string {
    return `projects/${this.projectId}/databases/${this.databaseId}/documents`;
  }

  private get apiBase(): string {
    return `https://firestore.googleapis.com/v1/${this.baseRoot}`;
  }

  private async request<T>(url: string, init: RequestInit): Promise<T> {
    const res = await fetch(url, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.idToken}`,
        ...(init.headers || {}),
      },
    });

    if (res.status === 404) {
      throw new AppError(404, 'DOCUMENT_NOT_FOUND', 'Requested record was not found.');
    }

    const body = (await res.json().catch(() => null)) as
      | { error?: { message?: string; status?: string } }
      | null;

    if (res.status === 403) {
      throw new AppError(
        403,
        'FORBIDDEN',
        body?.error?.message || 'Firestore security rules denied access to this resource.',
      );
    }

    if (res.status === 409 || body?.error?.status === 'ALREADY_EXISTS') {
      throw new AppError(
        409,
        'ALREADY_EXISTS',
        body?.error?.message || 'Record already exists.',
      );
    }

    if (!res.ok) {
      throw new AppError(
        res.status >= 400 && res.status < 500 ? res.status : 500,
        body?.error?.status || 'FIRESTORE_REST_ERROR',
        body?.error?.message || `Firestore request failed (${res.status}).`,
      );
    }

    return body as T;
  }

  async getDoc(docPath: string): Promise<Record<string, unknown> | null> {
    try {
      const doc = await this.request<FirestoreRestDoc>(`${this.apiBase}/${docPath}`, {
        method: 'GET',
      });
      return decodeDocumentFields(doc);
    } catch (err) {
      if (err instanceof AppError && err.statusCode === 404) {
        return null;
      }
      throw err;
    }
  }

  async listCollection(collectionPath: string): Promise<Record<string, unknown>[]> {
    const res = await this.request<{ documents?: FirestoreRestDoc[] }>(
      `${this.apiBase}/${collectionPath}?pageSize=200`,
      { method: 'GET' },
    );
    return (res.documents || []).map(decodeDocumentFields);
  }

  async runWorkspaceSubcollectionQuery(
    workspaceId: string,
    collectionId: string,
  ): Promise<Record<string, unknown>[]> {
    const parent = `${this.apiBase}/workspaces/${workspaceId}`;
    const res = await this.request<Array<{ document?: FirestoreRestDoc }>>(
      `${parent}:runQuery`,
      {
        method: 'POST',
        body: JSON.stringify({
          structuredQuery: {
            from: [{ collectionId }],
            where: {
              fieldFilter: {
                field: { fieldPath: 'workspaceId' },
                op: 'EQUAL',
                value: { stringValue: workspaceId },
              },
            },
            limit: 200,
          },
        }),
      },
    );
    return (res || [])
      .filter((row) => Boolean(row.document))
      .map((row) => decodeDocumentFields(row.document!));
  }

  async commit(ops: CommitWriteOp[]): Promise<void> {
    const writes = ops.map((op) => {
      const fullName = `${this.baseRoot}/${op.path}`;
      if (op.delete) {
        return { delete: fullName };
      }

      const write: Record<string, unknown> = {
        update: {
          name: fullName,
          fields: encodeDocumentFields(op.data || {}),
        },
      };

      if (op.preconditionExists !== undefined) {
        write.currentDocument = { exists: op.preconditionExists };
      }

      const transformSet = new Set(op.serverTimestampFields || []);
      if (op.updateMask && op.updateMask.length > 0) {
        const cleanMask = op.updateMask.filter((field) => !transformSet.has(field));
        if (cleanMask.length > 0) {
          write.updateMask = { fieldPaths: cleanMask };
        }
      }

      if (op.serverTimestampFields && op.serverTimestampFields.length > 0) {
        write.updateTransforms = op.serverTimestampFields.map((fieldPath) => ({
          fieldPath,
          setToServerValue: 'REQUEST_TIME',
        }));
      }

      return write;
    });

    await this.request(`${this.apiBase}:commit`, {
      method: 'POST',
      body: JSON.stringify({ writes }),
    });
  }
}
