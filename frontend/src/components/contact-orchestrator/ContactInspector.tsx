import { Contact } from './ContactDataTable';
import { useState } from 'react';
import { Sparkles, Send, Loader2, Copy, Pencil } from 'lucide-react';
import { toast } from 'sonner';
import { odyssey } from '@/lib/api/odyssey';
import { cn } from '@/lib/utils';

interface ContactInspectorProps {
  contact: Contact;
  senderName: string;
  language: string;
  activeAngle: 'direct' | 'micro' | 'peer';
}

interface DraftRecord {
  id: string;
  status: 'pending_review' | 'edited' | 'sent' | string;
  to_name: string;
  to_email: string | null;
  company: string;
  subject: string;
  body: string;
  sent_to?: string;
}

export function ContactInspector({ contact, senderName, language, activeAngle }: ContactInspectorProps) {
  const [draft, setDraft] = useState<DraftRecord | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);

  const activeMode = (): 'talent' | 'career' => {
    // Always return career mode since productMode was removed
    return 'career';
  };

  const handleGenerateDraft = async () => {
    if (!senderName.trim()) {
      toast.error('Set a sender name before drafting');
      return;
    }
    setLoading(true);
    try {
      const record = await odyssey.networking.draft(
        {
          contact_name: contact.name,
          contact_email: contact.email || undefined,
          company: contact.company,
          role: contact.role,
          context: contact.note || '',
          extra_context: contact.enrichment ?? {},
          angle: activeAngle,
          sign_off: senderName,
          language,
        },
        activeMode(),
      );
      setDraft({
        id: record.id,
        status: 'pending_review',
        to_name: contact.name,
        to_email: contact.email || null,
        company: contact.company,
        subject: record.subject,
        body: record.body,
      });
      toast.success('Draft ready');
    } catch (error) {
      console.error(error);
      toast.error('Failed to generate outreach draft');
    } finally {
      setLoading(false);
    }
  };

  const saveDraftEdits = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      const updated = await odyssey.networking.editDraft(draft.id, {
        subject: draft.subject,
        body: draft.body,
      });
      setDraft(updated as DraftRecord);
      toast.success('Draft saved');
    } catch (error) {
      console.error(error);
      toast.error('Failed to save edits');
    } finally {
      setSaving(false);
    }
  };

  const sendDraft = async () => {
    if (!draft) return;
    const overrideTo = draft.to_email
      ? undefined
      : window.prompt('No email on file — enter recipient address:') ?? undefined;
    if (!draft.to_email && !overrideTo) return;
    setSending(true);
    try {
      await saveDraftEdits();
      const sent = await odyssey.networking.sendDraft(draft.id, overrideTo);
      setDraft(sent as DraftRecord);
      toast.success(`Sent to ${(sent as DraftRecord).sent_to}`);
    } catch (error) {
      console.error(error);
      toast.error('Send failed — check SMTP configuration in Settings');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex flex-col">
      {/* Contact Details */}
      <div className="border-b border-border px-4 py-4">
        <h3 className="text-sm font-medium text-foreground mb-3">Contact Details</h3>
        <div className="space-y-2">
          <div>
            <div className="text-xs text-muted-foreground mb-0.5">Name</div>
            <div className="text-sm text-foreground">{contact.name}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground mb-0.5">Company</div>
            <div className="text-sm text-foreground">{contact.company || '—'}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground mb-0.5">Role</div>
            <div className="text-sm text-foreground">{contact.role || '—'}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground mb-0.5">Email</div>
            <div className="text-sm text-foreground font-mono">{contact.email || '—'}</div>
          </div>
          {contact.note && (
            <div>
              <div className="text-xs text-muted-foreground mb-0.5">Notes</div>
              <div className="text-sm text-foreground">{contact.note}</div>
            </div>
          )}
          {contact.enrichment && Object.keys(contact.enrichment).length > 0 && (
            <div>
              <div className="text-xs text-muted-foreground mb-0.5">Enrichment Data</div>
              <div className="text-xs text-muted-foreground">
                {Object.entries(contact.enrichment).map(([key, value]) => (
                  <div key={key} className="flex justify-between py-0.5">
                    <span className="text-muted-foreground">{key}:</span>
                    <span className="text-foreground">{value}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Email Drafting */}
      <div className="flex-1 px-4 py-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium text-foreground">Outreach Draft</h3>
          {!draft && (
            <button
              onClick={handleGenerateDraft}
              disabled={loading}
              className="inline-flex items-center gap-1.5 rounded-md border border-primary/60 bg-primary/10 px-2.5 py-1.5 text-xs font-medium text-primary hover:bg-primary/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Sparkles className="h-3.5 w-3.5" />
              )}
              Generate
            </button>
          )}
        </div>

        {draft ? (
          <div className="space-y-3">
            <div>
              <label className="block text-xs text-muted-foreground mb-1.5">Subject</label>
              <input
                type="text"
                value={draft.subject}
                onChange={(e) => setDraft({ ...draft, subject: e.target.value, status: 'edited' })}
                className="w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground outline-none focus:border-primary/60 transition-colors"
              />
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1.5">Body</label>
              <textarea
                value={draft.body}
                onChange={(e) => setDraft({ ...draft, body: e.target.value, status: 'edited' })}
                className="min-h-[200px] w-full resize-y rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground outline-none focus:border-primary/60 transition-colors leading-relaxed"
              />
            </div>
            <div className="flex items-center gap-2 pt-2">
              <button
                onClick={() => {
                  navigator.clipboard.writeText(draft.body);
                  toast('Copied to clipboard');
                }}
                className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
              >
                <Copy className="h-3.5 w-3.5" />
                Copy
              </button>
              <button
                onClick={saveDraftEdits}
                disabled={saving}
                className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {saving ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Pencil className="h-3.5 w-3.5" />
                )}
                Save
              </button>
              <button
                onClick={sendDraft}
                disabled={sending || draft.status === 'sent'}
                className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-primary/60 bg-primary/10 px-2.5 py-1.5 text-xs font-medium text-primary hover:bg-primary/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {sending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Send className="h-3.5 w-3.5" />
                )}
                Send
              </button>
            </div>
          </div>
        ) : (
          <div className="flex h-[200px] items-center justify-center text-center">
            <div>
              <p className="text-sm text-muted-foreground">No draft generated yet</p>
              <p className="mt-1 text-xs text-muted-foreground">Click Generate to create an outreach draft</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}