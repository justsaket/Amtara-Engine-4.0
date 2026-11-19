import crypto from 'node:crypto';
import type {
  LeadRecord,
  Phase4ErrorCode,
  ReviewCategory,
  ReviewRecord,
  SocialConversationRecord,
} from '@/types/domain';

// =============================================================================
// 1. Webhook HMAC Signature Verification & Deduplication
// =============================================================================

export function verifyMetaWebhookSignature(
  rawBody: string,
  signatureHeader: string | null | undefined,
  appSecret: string,
): { valid: boolean; reason?: string } {
  if (!appSecret.trim()) {
    return { valid: false, reason: 'META_APP_SECRET is not configured on the server.' };
  }
  if (!signatureHeader || !signatureHeader.startsWith('sha256=')) {
    return { valid: false, reason: 'Missing or malformed X-Hub-Signature-256 header.' };
  }
  const providedHex = signatureHeader.slice('sha256='.length).trim();
  const expectedHex = crypto
    .createHmac('sha256', appSecret)
    .update(rawBody, 'utf8')
    .digest('hex');

  const providedBuf = Buffer.from(providedHex, 'hex');
  const expectedBuf = Buffer.from(expectedHex, 'hex');
  if (providedBuf.length !== expectedBuf.length) {
    return { valid: false, reason: 'Meta webhook HMAC signature length mismatch.' };
  }
  const match = crypto.timingSafeEqual(providedBuf, expectedBuf);
  return match ? { valid: true } : { valid: false, reason: 'Meta webhook HMAC signature verification failed.' };
}

export function verifyTikTokWebhookSignature(
  rawBody: string,
  signatureHeader: string | null | undefined,
  clientSecret: string,
): { valid: boolean; reason?: string } {
  if (!clientSecret.trim()) {
    return { valid: false, reason: 'TIKTOK_CLIENT_SECRET is not configured on the server.' };
  }
  if (!signatureHeader) {
    return { valid: false, reason: 'Missing TikTok-Signature header.' };
  }
  // Supports "t=<timestamp>,s=<hmac_hex>" or raw hex signature
  const parts = Object.fromEntries(
    signatureHeader.split(',').map((seg) => {
      const [k, v] = seg.split('=');
      return [k?.trim(), v?.trim()];
    }),
  );
  const timestamp = parts.t;
  const sigHex = parts.s || signatureHeader.trim();
  const signedPayload = timestamp ? `${timestamp}.${rawBody}` : rawBody;
  const expectedHex = crypto
    .createHmac('sha256', clientSecret)
    .update(signedPayload, 'utf8')
    .digest('hex');

  const providedBuf = Buffer.from(sigHex, 'hex');
  const expectedBuf = Buffer.from(expectedHex, 'hex');
  if (providedBuf.length !== expectedBuf.length) {
    return { valid: false, reason: 'TikTok webhook signature length mismatch.' };
  }
  const match = crypto.timingSafeEqual(providedBuf, expectedBuf);
  return match ? { valid: true } : { valid: false, reason: 'TikTok webhook HMAC signature verification failed.' };
}

export function computeWebhookDedupeKey(provider: 'meta' | 'tiktok', rawBody: string, eventId?: string): string {
  const basis = eventId ? `${provider}:${eventId}` : `${provider}:${rawBody}`;
  return `wh_${crypto.createHash('sha256').update(basis).digest('hex').slice(0, 28)}`;
}

// =============================================================================
// 2. Social Inbox: Policy-Aware Messaging Window & Sensitive Topic Detection
// =============================================================================

const SENSITIVE_TOPIC_RULES: Array<{ label: string; regex: RegExp }> = [
  { label: 'legal_or_regulatory', regex: /\b(lawyer|legal|court|sue|consumer\s+forum|fraud|scam|police)\b/i },
  { label: 'refund_or_billing_dispute', regex: /\b(refund|chargeback|money\s+back|cheated|overcharged)\b/i },
  { label: 'safety_or_defect_incident', regex: /\b(fire|shock|injury|exploded|burn|safety\s+hazard|defective)\b/i },
  { label: 'severe_complaint', regex: /\b(worst|horrible|terrible|never\s+buying|pathetic|broken\s+on\s+arrival)\b/i },
];

export function detectSensitiveTopic(text: string): { sensitive: boolean; reason?: string } {
  for (const rule of SENSITIVE_TOPIC_RULES) {
    if (rule.regex.test(text)) {
      return { sensitive: true, reason: `Detected ${rule.label} trigger in customer message.` };
    }
  }
  return { sensitive: false };
}

export function validateMessagingWindow(
  conversation: Pick<
    SocialConversationRecord,
    'platform' | 'channelType' | 'messagingWindowType' | 'messagingWindowExpiresAt' | 'lastMessageAt'
  >,
  nowIso: string = new Date().toISOString(),
): {
  allowed: boolean;
  code?: Phase4ErrorCode;
  windowLabel: string;
  reason: string;
} {
  if (conversation.channelType === 'comment' || conversation.messagingWindowType === 'comment_public') {
    return {
      allowed: true,
      windowLabel: 'Public Comment Reply',
      reason: 'Public comments are not subject to the private 24-hour DM window.',
    };
  }

  if (conversation.platform === 'linkedin') {
    return {
      allowed: false,
      code: 'CAPABILITY_UNSUPPORTED',
      windowLabel: 'Unsupported DM API',
      reason: 'LinkedIn API does not permit automated direct message inbox replies.',
    };
  }

  const nowMs = Date.parse(nowIso);
  const lastMsgMs = Date.parse(conversation.lastMessageAt);

  // Meta distinguishes standard 24h messaging window from Click-to-Message / Direct ad extended window (up to 72h)
  const fallbackDurationMs =
    conversation.messagingWindowType === 'click_to_message_ad'
      ? 72 * 60 * 60 * 1000
      : 24 * 60 * 60 * 1000;

  const expiresMs = conversation.messagingWindowExpiresAt
    ? Date.parse(conversation.messagingWindowExpiresAt)
    : lastMsgMs + fallbackDurationMs;

  const label =
    conversation.messagingWindowType === 'click_to_message_ad'
      ? 'Meta Click-to-Message Ad Window (72h)'
      : 'Meta Standard Messaging Window (24h)';

  if (nowMs > expiresMs) {
    return {
      allowed: false,
      code: 'MESSAGING_WINDOW_EXPIRED',
      windowLabel: label,
      reason: `${label} expired at ${new Date(expiresMs).toISOString()}. Cold outreach outside Meta messaging policy is blocked.`,
    };
  }

  return {
    allowed: true,
    windowLabel: label,
    reason: `Within active ${label} until ${new Date(expiresMs).toISOString()}.`,
  };
}

// =============================================================================
// 3. Review & Reputation Management (8 Categories + Escalation)
// =============================================================================

export function classifyReviewFeedback(
  rating: 1 | 2 | 3 | 4 | 5,
  comment: string,
): {
  category: ReviewCategory;
  sentiment: ReviewRecord['sentiment'];
  escalationRequired: boolean;
} {
  const lower = comment.toLowerCase();
  const sensitive = detectSensitiveTopic(comment);

  const sentiment: ReviewRecord['sentiment'] =
    rating >= 4 ? 'positive' : rating === 3 ? 'neutral' : 'negative';

  if (sensitive.sensitive || rating === 1) {
    return {
      category: sensitive.sensitive ? 'escalation_required' : 'service_issue',
      sentiment,
      escalationRequired: true,
    };
  }
  if (/\b(spam|http:\/\/|https:\/\/|click\s+here|promo\s+code)\b/i.test(lower)) {
    return { category: 'spam_or_irrelevant', sentiment, escalationRequired: false };
  }
  if (/\b(late|delay|shipping|delivery|courier|dispatch|arrived\s+late)\b/i.test(lower)) {
    return { category: 'delivery_delay', sentiment, escalationRequired: rating <= 2 };
  }
  if (/\b(price|expensive|overpriced|cost|billing|invoice)\b/i.test(lower)) {
    return { category: 'pricing_concern', sentiment, escalationRequired: rating <= 2 };
  }
  if (/\b(install|manual|wiring|setup|technical|voltage|amperage|calibration|repair)\b/i.test(lower)) {
    return { category: 'technical_support', sentiment, escalationRequired: rating <= 2 };
  }
  if (/\b(quality|build|durable|material|weld|finish|stopped\s+working|defect)\b/i.test(lower)) {
    return {
      category: rating >= 4 ? 'praise' : 'product_quality',
      sentiment,
      escalationRequired: rating <= 2,
    };
  }
  if (rating >= 4) {
    return { category: 'praise', sentiment: 'positive', escalationRequired: false };
  }
  return { category: 'service_issue', sentiment, escalationRequired: rating <= 2 };
}

export function draftBrandSafeReviewReply(params: {
  brandName: string;
  reviewerName: string;
  rating: 1 | 2 | 3 | 4 | 5;
  category: ReviewCategory;
}): string {
  const firstName = params.reviewerName.trim().split(/\s+/)[0] || 'there';
  if (params.rating >= 4) {
    return `Thank you for sharing your feedback, ${firstName}. The ${params.brandName} team appreciates your trust and is glad our work met your expectations.`;
  }
  if (params.category === 'technical_support' || params.category === 'product_quality') {
    return `Hi ${firstName}, thank you for bringing this to our attention. Please share your order or unit reference directly with our ${params.brandName} support team so an engineer can review and resolve this promptly.`;
  }
  return `Hi ${firstName}, we take your experience seriously and want to review the details directly. Please contact our ${params.brandName} customer support desk with your reference details so our team can assist.`;
}

// =============================================================================
// 4. Lead Consent & Outreach Safety
// =============================================================================

export function canPerformExternalLeadOutreach(lead: Pick<LeadRecord, 'consentStatus' | 'stage'>): {
  allowed: boolean;
  reason: string;
} {
  if (lead.consentStatus === 'opted_out') {
    return {
      allowed: false,
      reason: 'Lead has opted out. All external outreach is strictly prohibited.',
    };
  }
  if (lead.consentStatus === 'unconfirmed') {
    return {
      allowed: false,
      reason: 'Lead consent is unconfirmed. Create internal follow-up tasks only until consent is verified.',
    };
  }
  if (lead.stage === 'ARCHIVED' || lead.stage === 'LOST') {
    return {
      allowed: false,
      reason: `Lead is in terminal stage "${lead.stage}".`,
    };
  }
  return {
    allowed: true,
    reason: `Lead consent status "${lead.consentStatus}" permits approved outreach via Central Action Gateway.`,
  };
}
