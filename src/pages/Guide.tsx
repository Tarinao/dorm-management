import { GUIDE, type Pair } from '../guide/content';
import { useI18n } from '../lib/i18n';
import { IconGlobe } from '../components/icons';
import { Btn, PageHead, Panel } from '../components/ui';

/** "How to use": the worker guide in the language chosen in the app (Thai or English). */
export default function Guide() {
  const { t, lang, setLang } = useI18n();
  const tx = (p: Pair) => (lang === 'th' ? p[1] : p[0]);

  return (
    <>
      <PageHead title={t('guide.title')} sub={t('guide.subtitle')}>
        <Btn variant="secondary" onClick={() => setLang(lang === 'th' ? 'en' : 'th')}><IconGlobe size={17} />{t('guide.switch')}</Btn>
      </PageHead>

      <Panel>
        <div className="text-[12px] uppercase tracking-wide text-muted mb-2">{t('guide.contents')}</div>
        <ol className="m-0 pl-5 flex flex-col gap-1.5">
          {GUIDE.map((s) => (
            <li key={s.id}><a href={`#guide-${s.id}`} onClick={(e) => { e.preventDefault(); document.getElementById(`guide-${s.id}`)?.scrollIntoView({ behavior: 'smooth' }); }}
              className="text-teal no-underline">{tx(s.title)}</a></li>
          ))}
        </ol>
      </Panel>

      {GUIDE.map((s, i) => (
        <Panel key={s.id}>
          <section id={`guide-${s.id}`} className="scroll-mt-20">
            <h2 className="text-lg mt-0 mb-1">{i + 1}. {tx(s.title)}</h2>
            <p className="text-muted text-[13.5px] mt-0 mb-3">{tx(s.intro)}</p>
            <ol className="list-none p-0 m-0 flex flex-col gap-2.5">
              {s.steps.map((step, j) => (
                <li key={j} className="flex gap-3 text-[15px] leading-relaxed">
                  <span className="shrink-0 w-7 h-7 rounded-full bg-teal-soft text-teal font-semibold text-[13px] flex items-center justify-center">{j + 1}</span>
                  <span>{tx(step)}</span>
                </li>
              ))}
            </ol>
            {s.tip && <div className="mt-3 text-[13.5px] bg-amber-soft text-ink rounded px-3 py-2"><strong>{t('guide.tip')}:</strong> {tx(s.tip)}</div>}
          </section>
        </Panel>
      ))}
    </>
  );
}
