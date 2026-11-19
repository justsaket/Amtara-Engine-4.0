'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Pencil, Plus, Sparkles, Trash2, Upload } from 'lucide-react';
import { useWorkspace } from '@/components/providers/WorkspaceContext';
import { apiRequest } from '@/lib/api-client';
import { uploadBrandLogoFile } from '@/lib/firebase/storage';
import { hasPermission } from '@/lib/rbac';
import type { BrandProfile } from '@/types/domain';

interface BrandFormState {
  id?: string;
  name: string;
  description: string;
  industry: string;
  websiteUrl: string;
  targetAudience: string;
  brandVoice: string;
  contentPillarsText: string;
  primaryColor: string;
  accentColor: string;
  restrictions: string;
  logoPath: string;
  status: BrandProfile['status'];
}

const EMPTY_FORM: BrandFormState = {
  name: '',
  description: '',
  industry: '',
  websiteUrl: '',
  targetAudience: '',
  brandVoice: '',
  contentPillarsText: '',
  primaryColor: '#1D4ED8',
  accentColor: '#0F172A',
  restrictions: '',
  logoPath: '',
  status: 'active',
};

export default function BrandsPage() {
  const { activeWorkspace, refreshWorkspaces } = useWorkspace();
  const [brands, setBrands] = useState<BrandProfile[]>([]);
  const [loading, setLoading] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<BrandFormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canCreate = hasPermission(activeWorkspace?.role, 'brands:create');
  const canUpdate = hasPermission(activeWorkspace?.role, 'brands:update');
  const canDelete = hasPermission(activeWorkspace?.role, 'brands:delete');

  const loadBrands = useCallback(async () => {
    if (!activeWorkspace) return;
    setLoading(true);
    try {
      const data = await apiRequest<{ brands: BrandProfile[] }>(
        `/api/workspaces/${activeWorkspace.id}/brands`,
      );
      setBrands(data.brands);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load brand profiles.');
    } finally {
      setLoading(false);
    }
  }, [activeWorkspace]);

  useEffect(() => {
    void loadBrands();
  }, [loadBrands]);

  function openNewForm() {
    setForm(EMPTY_FORM);
    setFormOpen(true);
  }

  function openEditForm(brand: BrandProfile) {
    setForm({
      id: brand.id,
      name: brand.name,
      description: brand.description || '',
      industry: brand.industry || '',
      websiteUrl: brand.websiteUrl || '',
      targetAudience: brand.targetAudience || '',
      brandVoice: brand.brandVoice || '',
      contentPillarsText: brand.contentPillars.join(', '),
      primaryColor: brand.primaryColor,
      accentColor: brand.accentColor || '',
      restrictions: brand.restrictions || '',
      logoPath: brand.logoPath || '',
      status: brand.status,
    });
    setFormOpen(true);
  }

  async function handleSeedStarterBrands() {
    if (!activeWorkspace) return;
    setError(null);
    setFeedback(null);
    setSaving(true);
    try {
      const data = await apiRequest<{ brands: BrandProfile[] }>(
        `/api/workspaces/${activeWorkspace.id}/brands`,
        {
          method: 'POST',
          body: JSON.stringify({ action: 'seed_starter_brands' }),
        },
      );
      setBrands(data.brands);
      await refreshWorkspaces();
      setFeedback(
        'Initialized starter brand profiles (Saket Personal, MAGNARC, GreenWeld, Sapphire).',
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to initialize starter brands.');
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveForm(e: React.FormEvent) {
    e.preventDefault();
    if (!activeWorkspace) return;
    setSaving(true);
    setError(null);
    setFeedback(null);

    const payload = {
      name: form.name.trim(),
      description: form.description.trim(),
      industry: form.industry.trim(),
      websiteUrl: form.websiteUrl.trim(),
      targetAudience: form.targetAudience.trim(),
      brandVoice: form.brandVoice.trim(),
      contentPillars: form.contentPillarsText
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 12),
      primaryColor: form.primaryColor,
      accentColor: form.accentColor.trim(),
      restrictions: form.restrictions.trim(),
      logoPath: form.logoPath.trim(),
      status: form.status,
    };

    try {
      if (form.id) {
        await apiRequest(`/api/workspaces/${activeWorkspace.id}/brands/${form.id}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
        setFeedback(`Updated "${payload.name}".`);
      } else {
        await apiRequest(`/api/workspaces/${activeWorkspace.id}/brands`, {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        setFeedback(`Created "${payload.name}".`);
      }
      setFormOpen(false);
      await loadBrands();
      await refreshWorkspaces();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save brand profile.');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(brand: BrandProfile) {
    if (!activeWorkspace) return;
    setError(null);
    setFeedback(null);
    try {
      await apiRequest(`/api/workspaces/${activeWorkspace.id}/brands/${brand.id}`, {
        method: 'DELETE',
      });
      setFeedback(`Deleted brand profile "${brand.name}".`);
      await loadBrands();
      await refreshWorkspaces();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete brand profile.');
    }
  }

  async function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !activeWorkspace) return;
    setUploadingLogo(true);
    setError(null);
    try {
      const url = await uploadBrandLogoFile(
        activeWorkspace.id,
        form.id || 'draft',
        file,
      );
      setForm((prev) => ({ ...prev, logoPath: url }));
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Unable to upload logo to Firebase Storage.',
      );
    } finally {
      setUploadingLogo(false);
    }
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="font-mono text-xs uppercase tracking-widest text-blue-700">
            Brand Identity Registry
          </p>
          <h1 className="mt-1 font-display text-2xl font-semibold text-slate-900">
            Workspace Brand Profiles
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Manage editable brand profiles including Saket Personal, MAGNARC, GreenWeld,
            Sapphire, or custom tenant brands.
          </p>
        </div>

        {canCreate && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={saving}
              onClick={handleSeedStarterBrands}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              <Sparkles className="h-3.5 w-3.5 text-blue-700" />
              Initialize Starter Brands
            </button>
            <button
              type="button"
              onClick={openNewForm}
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-700 px-4 py-2 text-xs font-medium text-white hover:bg-blue-800"
            >
              <Plus className="h-3.5 w-3.5" />
              New Brand Profile
            </button>
          </div>
        )}
      </div>

      {feedback && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          {feedback}
        </div>
      )}
      {error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          {error}
        </div>
      )}

      {formOpen && (
        <section className="rounded-xl border border-slate-200 bg-white p-6">
          <h2 className="text-base font-semibold text-slate-900">
            {form.id ? `Edit ${form.name}` : 'Create Brand Profile'}
          </h2>
          <form onSubmit={handleSaveForm} className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <label
                htmlFor="brand-name"
                className="block text-xs font-medium text-slate-700"
              >
                Brand Name
              </label>
              <input
                id="brand-name"
                type="text"
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label
                htmlFor="brand-industry"
                className="block text-xs font-medium text-slate-700"
              >
                Industry / Focus
              </label>
              <input
                id="brand-industry"
                type="text"
                value={form.industry}
                onChange={(e) => setForm({ ...form, industry: e.target.value })}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>

            <div className="sm:col-span-2">
              <label
                htmlFor="brand-desc"
                className="block text-xs font-medium text-slate-700"
              >
                Description
              </label>
              <textarea
                id="brand-desc"
                rows={2}
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label
                htmlFor="brand-audience"
                className="block text-xs font-medium text-slate-700"
              >
                Target Audience
              </label>
              <input
                id="brand-audience"
                type="text"
                value={form.targetAudience}
                onChange={(e) => setForm({ ...form, targetAudience: e.target.value })}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label
                htmlFor="brand-voice"
                className="block text-xs font-medium text-slate-700"
              >
                Brand Voice
              </label>
              <input
                id="brand-voice"
                type="text"
                value={form.brandVoice}
                onChange={(e) => setForm({ ...form, brandVoice: e.target.value })}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label
                htmlFor="brand-pillars"
                className="block text-xs font-medium text-slate-700"
              >
                Content Pillars (comma separated)
              </label>
              <input
                id="brand-pillars"
                type="text"
                value={form.contentPillarsText}
                onChange={(e) =>
                  setForm({ ...form, contentPillarsText: e.target.value })
                }
                placeholder="Engineering Reliability, Documentation"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label
                htmlFor="brand-website"
                className="block text-xs font-medium text-slate-700"
              >
                Website URL
              </label>
              <input
                id="brand-website"
                type="url"
                value={form.websiteUrl}
                onChange={(e) => setForm({ ...form, websiteUrl: e.target.value })}
                placeholder="https://example.com"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label
                htmlFor="brand-primary-color"
                className="block text-xs font-medium text-slate-700"
              >
                Primary Hex Color
              </label>
              <input
                id="brand-primary-color"
                type="text"
                required
                value={form.primaryColor}
                onChange={(e) => setForm({ ...form, primaryColor: e.target.value })}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm"
              />
            </div>

            <div>
              <label
                htmlFor="brand-status"
                className="block text-xs font-medium text-slate-700"
              >
                Status
              </label>
              <select
                id="brand-status"
                value={form.status}
                onChange={(e) =>
                  setForm({
                    ...form,
                    status: e.target.value as BrandProfile['status'],
                  })
                }
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
              >
                <option value="active">active</option>
                <option value="draft">draft</option>
                <option value="archived">archived</option>
              </select>
            </div>

            <div className="sm:col-span-2">
              <label
                htmlFor="brand-restrictions"
                className="block text-xs font-medium text-slate-700"
              >
                Editorial Restrictions & Guardrails
              </label>
              <input
                id="brand-restrictions"
                type="text"
                value={form.restrictions}
                onChange={(e) => setForm({ ...form, restrictions: e.target.value })}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-slate-700">
                Brand Logo (Firebase Storage)
              </label>
              <div className="mt-1.5 flex flex-wrap items-center gap-3">
                <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50">
                  <Upload className="h-3.5 w-3.5" />
                  {uploadingLogo ? 'Uploading…' : 'Upload Logo'}
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleLogoUpload}
                    className="hidden"
                  />
                </label>
                {form.logoPath && (
                  <span className="truncate font-mono text-xs text-slate-500">
                    {form.logoPath}
                  </span>
                )}
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 sm:col-span-2">
              <button
                type="button"
                onClick={() => setFormOpen(false)}
                className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-medium text-slate-700"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="rounded-lg bg-blue-700 px-4 py-2 text-xs font-medium text-white hover:bg-blue-800 disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Save Brand Profile'}
              </button>
            </div>
          </form>
        </section>
      )}

      {loading ? (
        <p className="text-sm text-slate-500">Loading brand profiles…</p>
      ) : brands.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center">
          <h2 className="text-base font-semibold text-slate-900">
            No brand profiles in this workspace yet
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Initialize the editable starter baselines (Saket Personal, MAGNARC,
            GreenWeld, Sapphire) or create a custom brand profile.
          </p>
        </div>
      ) : (
        <div className="grid gap-5 md:grid-cols-2">
          {brands.map((brand) => (
            <div
              key={brand.id}
              className="flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-6"
            >
              <div>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    {brand.logoPath ? (
                      <img
                        src={brand.logoPath}
                        alt={`${brand.name} logo`}
                        className="h-10 w-10 rounded-lg border border-slate-200 object-cover"
                      />
                    ) : (
                      <span
                        className="flex h-10 w-10 items-center justify-center rounded-lg text-xs font-semibold text-white"
                        style={{ backgroundColor: brand.primaryColor }}
                      >
                        {brand.name.slice(0, 2).toUpperCase()}
                      </span>
                    )}
                    <div>
                      <h2 className="text-base font-semibold text-slate-900">
                        {brand.name}
                      </h2>
                      <p className="font-mono text-[11px] uppercase text-slate-500">
                        {brand.status} · {brand.industry || 'General'}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-1">
                    {canUpdate && (
                      <button
                        type="button"
                        aria-label={`Edit ${brand.name}`}
                        onClick={() => openEditForm(brand)}
                        className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                    )}
                    {canDelete && (
                      <button
                        type="button"
                        aria-label={`Delete ${brand.name}`}
                        onClick={() => handleDelete(brand)}
                        className="rounded-md p-1.5 text-slate-500 hover:bg-rose-50 hover:text-rose-700"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>

                {brand.description && (
                  <p className="mt-3 text-sm leading-relaxed text-slate-600">
                    {brand.description}
                  </p>
                )}

                <dl className="mt-4 space-y-2 border-t border-slate-100 pt-3 text-xs">
                  {brand.targetAudience && (
                    <div>
                      <dt className="font-medium text-slate-500">Audience</dt>
                      <dd className="text-slate-800">{brand.targetAudience}</dd>
                    </div>
                  )}
                  {brand.brandVoice && (
                    <div>
                      <dt className="font-medium text-slate-500">Brand Voice</dt>
                      <dd className="text-slate-800">{brand.brandVoice}</dd>
                    </div>
                  )}
                  {brand.contentPillars.length > 0 && (
                    <div>
                      <dt className="font-medium text-slate-500">Content Pillars</dt>
                      <dd className="text-slate-800">
                        {brand.contentPillars.join(' · ')}
                      </dd>
                    </div>
                  )}
                  {brand.restrictions && (
                    <div>
                      <dt className="font-medium text-slate-500">Guardrails</dt>
                      <dd className="text-slate-700">{brand.restrictions}</dd>
                    </div>
                  )}
                </dl>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
