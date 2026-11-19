import { useState } from 'react';
import { ContactDataTable, Contact } from './ContactDataTable';
import { ContactInspector } from './ContactInspector';
import { useWorkspaceStore } from '@/stores/workspace.store';
import { Plus, Upload, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useLocalStorage } from '@/hooks/use-local-storage';

export function ContactOrchestratorModule() {
  const { selectedId } = useWorkspaceStore();
  const [contacts, setContacts] = useLocalStorage<Contact[]>('odyssey.network.contacts', []);
  const [form, setForm] = useState<Contact>({ id: '', name: '', company: '', role: '', email: '', note: '' });
  const [senderName, setSenderName] = useLocalStorage<string>('odyssey.network.sender', '');
  const [language, setLanguage] = useLocalStorage<string>('odyssey.network.lang', 'English');
  const [activeAngle, setActiveAngle] = useState<'direct' | 'micro' | 'peer'>('peer');
  const [showAddForm, setShowAddForm] = useState(false);

  const selectedContact = contacts.find((c) => c.id === selectedId) || null;

  const uid = () => 'c_' + Math.random().toString(36).slice(2, 10);

  const parseCsv = (text: string): Contact[] => {
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    if (lines.length < 2) return [];
    const header = lines[0].toLowerCase().split(',').map((h) => h.trim());
    const idx = (k: string) => header.indexOf(k);
    const out: Contact[] = [];
    for (let i = 1; i < lines.length; i++) {
      const cells = lines[i].split(',').map((c) => c.trim());
      out.push({
        id: uid(),
        name: cells[idx('name')] ?? cells[0] ?? 'Unknown',
        company: cells[idx('company')] ?? '',
        role: cells[idx('role')] ?? '',
        email: cells[idx('email')] ?? '',
        note: cells[idx('note')] ?? '',
      });
    }
    return out;
  };

  const onCsv = async (file: File) => {
    const text = await file.text();
    const rows = parseCsv(text);
    if (!rows.length) return toast.error('CSV looked empty — needs header row with name,company,role,email');
    setContacts((p) => [...rows, ...p]);
    toast.success(`Ingested ${rows.length} contacts`);
  };

  const addContact = () => {
    if (!form.name.trim()) return toast.error('Name required');
    setContacts((p) => [{ ...form, id: uid() }, ...p]);
    setForm({ id: '', name: '', company: '', role: '', email: '', note: '' });
    setShowAddForm(false);
    toast.success('Contact added');
  };

  const removeContact = (id: string) => {
    setContacts((p) => p.filter((c) => c.id !== id));
    toast.success('Contact removed');
  };

  const handleSelectContact = (id: string) => {
    // Selection is handled by the DataTable component
  };

  return (
    <div className="flex h-full">
      {/* Left: Data Table (60%) */}
      <div className="flex w-[60%] flex-col border-r border-border">
        {/* Toolbar */}
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-border bg-secondary/50 px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-secondary transition-colors">
              <Upload className="h-3.5 w-3.5" />
              Import CSV
              <input
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => e.target.files?.[0] && onCsv(e.target.files[0])}
              />
            </label>
            <button
              onClick={() => setShowAddForm(!showAddForm)}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-secondary/50 px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-secondary transition-colors"
            >
              <Plus className="h-3.5 w-3.5" />
              Add Contact
            </button>
          </div>
          {contacts.length > 0 && (
            <button
              onClick={() => {
                setContacts([]);
                toast('Contacts cleared');
              }}
              className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
            >
              Clear All
            </button>
          )}
        </div>

        {/* Add Contact Form */}
        {showAddForm && (
          <div className="border-b border-border bg-secondary/30 px-4 py-3">
            <div className="grid grid-cols-2 gap-2">
              <input
                placeholder="Name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="rounded-md border border-border bg-input px-3 py-1.5 text-sm text-foreground outline-none focus:border-primary/60 transition-colors"
              />
              <input
                placeholder="Company"
                value={form.company}
                onChange={(e) => setForm({ ...form, company: e.target.value })}
                className="rounded-md border border-border bg-input px-3 py-1.5 text-sm text-foreground outline-none focus:border-primary/60 transition-colors"
              />
              <input
                placeholder="Role"
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value })}
                className="rounded-md border border-border bg-input px-3 py-1.5 text-sm text-foreground outline-none focus:border-primary/60 transition-colors"
              />
              <input
                placeholder="Email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                className="rounded-md border border-border bg-input px-3 py-1.5 text-sm text-foreground outline-none focus:border-primary/60 transition-colors"
              />
            </div>
            <input
              placeholder="Notes (optional)"
              value={form.note || ''}
              onChange={(e) => setForm({ ...form, note: e.target.value })}
              className="mt-2 w-full rounded-md border border-border bg-input px-3 py-1.5 text-sm text-foreground outline-none focus:border-primary/60 transition-colors"
            />
            <div className="mt-2 flex items-center gap-2">
              <button
                onClick={addContact}
                className="inline-flex items-center gap-1.5 rounded-md border border-primary/60 bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/20 transition-colors"
              >
                <Plus className="h-3.5 w-3.5" />
                Add Contact
              </button>
              <button
                onClick={() => setShowAddForm(false)}
                className="rounded-md px-3 py-1.5 text-xs text-muted-foreground hover:bg-secondary/50 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Configuration Strip */}
        <div className="flex items-center gap-4 border-b border-border bg-secondary/20 px-4 py-2">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Sender</span>
            <input
              type="text"
              value={senderName}
              onChange={(e) => setSenderName(e.target.value)}
              placeholder="Your name"
              className="w-32 rounded-md border border-transparent bg-transparent px-2 py-1 text-sm text-foreground outline-none transition-colors hover:bg-secondary/50 focus:border-primary/50 focus:bg-input"
            />
          </div>
          <div className="h-4 w-px bg-border" />
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Language</span>
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              className="rounded-md border border-transparent bg-transparent px-2 py-1 text-sm text-foreground outline-none transition-colors hover:bg-secondary/50 focus:border-primary/50 focus:bg-input"
            >
              <option value="English">English</option>
              <option value="German">German</option>
              <option value="French">French</option>
              <option value="Spanish">Spanish</option>
            </select>
          </div>
          <div className="h-4 w-px bg-border" />
          <div className="flex items-center gap-1">
            <span className="mr-2 text-xs text-muted-foreground">Angle</span>
            {(['direct', 'micro', 'peer'] as const).map((a) => (
              <button
                key={a}
                onClick={() => setActiveAngle(a)}
                className={`rounded-md px-2 py-1 text-xs font-medium capitalize transition-all ${
                  activeAngle === a
                    ? 'border border-primary/50 bg-primary/10 text-primary'
                    : 'border border-transparent text-muted-foreground hover:bg-secondary/50 hover:text-foreground'
                }`}
              >
                {a}
              </button>
            ))}
          </div>
        </div>

        {/* Data Table */}
        <ContactDataTable
          contacts={contacts}
          selectedId={selectedId}
          onSelectContact={handleSelectContact}
        />
      </div>

      {/* Right: Detail View (40%) */}
      <div className="flex w-[40%] flex-col">
        {selectedContact ? (
          <ContactInspector
            contact={selectedContact}
            senderName={senderName}
            language={language}
            activeAngle={activeAngle}
          />
        ) : (
          <div className="flex h-full items-center justify-center">
            <div className="text-center">
              <p className="text-sm text-muted-foreground">Select a contact to view details</p>
              <p className="mt-1 text-xs text-muted-foreground">Click on any contact in the table</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}