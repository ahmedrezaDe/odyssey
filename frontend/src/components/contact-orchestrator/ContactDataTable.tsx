import { useWorkspaceStore } from '@/stores/workspace.store';
import { cn } from '@/lib/utils';
import { Check, Clock, X } from 'lucide-react';

export interface Contact {
  id: string;
  name: string;
  company: string;
  role: string;
  email: string;
  note?: string;
  enrichment?: Record<string, string>;
}

interface ContactDataTableProps {
  contacts: Contact[];
  selectedId: string | null;
  onSelectContact: (id: string) => void;
}

export function ContactDataTable({ contacts, selectedId, onSelectContact }: ContactDataTableProps) {
  const { setInspectorOpen, setSelectedId } = useWorkspaceStore();

  const handleRowClick = (contact: Contact) => {
    setSelectedId(contact.id);
    setInspectorOpen(true);
    onSelectContact(contact.id);
  };

  const getEnrichmentStatus = (contact: Contact) => {
    if (contact.enrichment && Object.keys(contact.enrichment).length > 0) {
      return 'enriched';
    }
    return 'pending';
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'enriched':
        return <Check className="h-3.5 w-3.5 text-success" />;
      case 'pending':
        return <Clock className="h-3.5 w-3.5 text-muted-foreground" />;
      default:
        return <X className="h-3.5 w-3.5 text-muted-foreground" />;
    }
  };

  return (
    <div className="flex h-full flex-col">
      {/* Table Header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="text-sm font-medium text-foreground">Contacts</h2>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{contacts.length} contacts</span>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-y-auto">
        {contacts.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <div className="text-center">
              <p className="text-sm text-muted-foreground">No contacts yet</p>
              <p className="mt-1 text-xs text-muted-foreground">Add contacts to get started</p>
            </div>
          </div>
        ) : (
          <table className="w-full">
            <thead className="sticky top-0 bg-card">
              <tr className="border-b border-border">
                <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Name
                </th>
                <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Company
                </th>
                <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Role
                </th>
                <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Status
                </th>
              </tr>
            </thead>
            <tbody>
              {contacts.map((contact) => {
                const isSelected = selectedId === contact.id;
                const enrichmentStatus = getEnrichmentStatus(contact);
                
                return (
                  <tr
                    key={contact.id}
                    onClick={() => handleRowClick(contact)}
                    className={cn(
                      'border-b border-border/50 transition-colors cursor-pointer',
                      isSelected ? 'bg-secondary/50' : 'hover:bg-secondary/30'
                    )}
                  >
                    <td className="px-4 py-3">
                      <div className="text-sm font-medium text-foreground">{contact.name}</div>
                      <div className="text-xs text-muted-foreground font-mono">{contact.email || '—'}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-sm text-foreground">{contact.company || '—'}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-sm text-muted-foreground">{contact.role || '—'}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {getStatusIcon(enrichmentStatus)}
                        <span className="text-xs text-muted-foreground capitalize">{enrichmentStatus}</span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}