import { useRef, useState } from 'react';
import { ChevronUp, FileText, Pencil, RotateCcw } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import {
  DEFAULT_EMAIL_SUBJECT_TEMPLATE,
  DEFAULT_WHATSAPP_MESSAGE_TEMPLATE,
  SMOOTH_EASE,
  TEMPLATE_PLACEHOLDERS,
} from '../../utils/constants';
import { renderPreviewTemplate } from '../../utils/validation';
import { SectionSaveBar } from './SectionSaveBar';

interface TemplatesSectionProps {
  emailSubjectTemplate: string;
  whatsappMessageTemplate: string;
  portalUrl: string;
  dirty: boolean;
  saving: boolean;
  onChangeSubject: (next: string) => void;
  onChangeWhatsapp: (next: string) => void;
  onDiscard: () => void;
}

export function TemplatesSection({
  emailSubjectTemplate,
  whatsappMessageTemplate,
  portalUrl,
  dirty,
  saving,
  onChangeSubject,
  onChangeWhatsapp,
  onDiscard,
}: TemplatesSectionProps) {
  const [expanded, setExpanded] = useState(false);
  const [activeField, setActiveField] = useState<'subject' | 'whatsapp'>('whatsapp');
  const subjectInputRef = useRef<HTMLInputElement>(null);
  const whatsappTextareaRef = useRef<HTMLTextAreaElement>(null);

  const insertPlaceholder = (token: string) => {
    if (activeField === 'subject') {
      const input = subjectInputRef.current;
      const start = input?.selectionStart ?? emailSubjectTemplate.length;
      const end = input?.selectionEnd ?? emailSubjectTemplate.length;
      const next = emailSubjectTemplate.slice(0, start) + token + emailSubjectTemplate.slice(end);
      onChangeSubject(next);
      window.requestAnimationFrame(() => {
        if (input) {
          input.focus();
          input.setSelectionRange(start + token.length, start + token.length);
        }
      });
    } else {
      const textarea = whatsappTextareaRef.current;
      const start = textarea?.selectionStart ?? whatsappMessageTemplate.length;
      const end = textarea?.selectionEnd ?? whatsappMessageTemplate.length;
      const next =
        whatsappMessageTemplate.slice(0, start) + token + whatsappMessageTemplate.slice(end);
      onChangeWhatsapp(next);
      window.requestAnimationFrame(() => {
        if (textarea) {
          textarea.focus();
          textarea.setSelectionRange(start + token.length, start + token.length);
        }
      });
    }
  };

  return (
    <section className="bg-white border border-slate-200 rounded-lg p-6 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-3">
        <div className="flex items-center gap-2.5">
          <FileText className="w-4 h-4 text-[#006837]" aria-hidden="true" />
          <div>
            <h2 className="font-display text-base font-semibold text-[#006837]">Templates</h2>
            <p className="text-xs text-slate-500">
              Customize email subject line and WhatsApp message body with dynamic placeholders.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setExpanded((prev) => !prev)}
          aria-expanded={expanded}
          className={`inline-flex items-center gap-1.5 px-4 py-2 rounded text-xs font-bold uppercase tracking-wider border transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
            expanded
              ? 'border-slate-300 bg-slate-50 text-[#0F2437] hover:bg-slate-100'
              : 'border-[#2B7A3B] bg-white text-[#1E6B34] hover:bg-emerald-50'
          }`}
        >
          {expanded ? (
            <>
              <ChevronUp className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Hide Template Editor</span>
            </>
          ) : (
            <>
              <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Edit Templates</span>
            </>
          )}
        </button>
      </div>

      {!expanded && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
          <div className="rounded-md border border-slate-200 bg-slate-50/70 px-3.5 py-2.5">
            <div className="font-semibold text-slate-700 mb-1">Email Subject Line</div>
            <div className="font-mono text-[#0F2437] truncate">
              {emailSubjectTemplate || DEFAULT_EMAIL_SUBJECT_TEMPLATE}
            </div>
          </div>
          <div className="rounded-md border border-slate-200 bg-slate-50/70 px-3.5 py-2.5">
            <div className="font-semibold text-slate-700 mb-1">WhatsApp Message Body</div>
            <div className="font-mono text-[#0F2437] truncate">
              {(whatsappMessageTemplate || DEFAULT_WHATSAPP_MESSAGE_TEMPLATE)
                .split('\n')
                .filter(Boolean)
                .slice(0, 2)
                .join(' · ')}
            </div>
          </div>
        </div>
      )}

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            key="templates-editor"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2, ease: SMOOTH_EASE }}
            className="overflow-hidden"
          >
            <div className="space-y-5 pt-1">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <span className="text-xs font-medium text-slate-600">Dynamic Placeholders</span>
                <span className="text-xs text-slate-500">
                  Click any chip to insert into{' '}
                  <strong className="text-[#0F2437]">
                    {activeField === 'subject' ? 'Email Subject Line' : 'WhatsApp Message Body'}
                  </strong>
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                {TEMPLATE_PLACEHOLDERS.map((item) => (
                  <button
                    key={item.token}
                    type="button"
                    onClick={() => insertPlaceholder(item.token)}
                    title={`Insert ${item.token} (${item.label})`}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded border border-slate-200 bg-slate-50 hover:border-[#2B7A3B] hover:bg-emerald-50 text-xs transition-colors cursor-pointer"
                  >
                    <code className="font-mono font-semibold text-[#1E6B34]">{item.token}</code>
                    <span className="text-[11px] text-slate-500">{item.label}</span>
                  </button>
                ))}
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <label
                    htmlFor="email-subject-tpl"
                    className="block text-xs font-semibold text-slate-800"
                  >
                    Email Subject Line Template
                  </label>
                  {emailSubjectTemplate !== DEFAULT_EMAIL_SUBJECT_TEMPLATE && (
                    <button
                      type="button"
                      onClick={() => onChangeSubject(DEFAULT_EMAIL_SUBJECT_TEMPLATE)}
                      className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-600 hover:text-[#2B7A3B] cursor-pointer"
                    >
                      <RotateCcw className="w-3 h-3" aria-hidden="true" />
                      <span>Reset Default</span>
                    </button>
                  )}
                </div>
                <input
                  ref={subjectInputRef}
                  id="email-subject-tpl"
                  value={emailSubjectTemplate}
                  onFocus={() => setActiveField('subject')}
                  onChange={(e) => onChangeSubject(e.target.value)}
                  placeholder={DEFAULT_EMAIL_SUBJECT_TEMPLATE}
                  className="w-full px-3.5 py-2.5 rounded-md border border-slate-300 text-sm font-mono text-[#0F2437] focus:outline-none focus:border-[#006837]"
                />
                <div className="bg-slate-50 border border-slate-200 rounded px-3 py-2 text-xs text-slate-600">
                  <span className="font-semibold text-slate-700">Subject Preview: </span>
                  <span className="text-[#0F2437]">
                    {renderPreviewTemplate(
                      emailSubjectTemplate.trim() || DEFAULT_EMAIL_SUBJECT_TEMPLATE,
                      portalUrl,
                      true
                    )}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <label
                      htmlFor="whatsapp-body-tpl"
                      className="block text-xs font-semibold text-slate-800"
                    >
                      WhatsApp Message Body Template
                    </label>
                    {whatsappMessageTemplate !== DEFAULT_WHATSAPP_MESSAGE_TEMPLATE && (
                      <button
                        type="button"
                        onClick={() => onChangeWhatsapp(DEFAULT_WHATSAPP_MESSAGE_TEMPLATE)}
                        className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-600 hover:text-[#2B7A3B] cursor-pointer"
                      >
                        <RotateCcw className="w-3 h-3" aria-hidden="true" />
                        <span>Reset Default</span>
                      </button>
                    )}
                  </div>
                  <textarea
                    ref={whatsappTextareaRef}
                    id="whatsapp-body-tpl"
                    rows={8}
                    value={whatsappMessageTemplate}
                    onFocus={() => setActiveField('whatsapp')}
                    onChange={(e) => onChangeWhatsapp(e.target.value)}
                    placeholder={DEFAULT_WHATSAPP_MESSAGE_TEMPLATE}
                    className="w-full px-3.5 py-2.5 rounded-md border border-slate-300 text-xs font-mono leading-relaxed text-[#0F2437] focus:outline-none focus:border-[#006837]"
                  />
                </div>

                <div className="space-y-2">
                  <div className="text-xs font-semibold text-slate-800">
                    WhatsApp Caption Preview (Sample Member)
                  </div>
                  <pre className="p-3.5 rounded-md border border-emerald-200 bg-emerald-50/40 text-xs font-sans text-[#0F2437] whitespace-pre-wrap leading-relaxed min-h-[196px]">
                    {renderPreviewTemplate(
                      whatsappMessageTemplate.trim() || DEFAULT_WHATSAPP_MESSAGE_TEMPLATE,
                      portalUrl,
                      false
                    )}
                  </pre>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <SectionSaveBar dirty={dirty} saving={saving} onDiscard={onDiscard} />
    </section>
  );
}
