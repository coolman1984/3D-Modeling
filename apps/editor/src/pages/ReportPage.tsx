import { checkProject, type Project } from '@space-planner/core';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { formatArea, formatCount, formatLength, formatPercent } from '../logic/format.js';
import { buildReport } from '../logic/report.js';
import { PlanDrawing } from '../ui/PlanDrawing.js';
import { renderSnapshot } from '../ui/View3D.js';

const VERDICT = {
  ready: { text: 'التصميم سليم: مفيش تداخل ولا باب مسدود ولا عنصر برّه الحدود.', className: 'ok' },
  check: { text: 'مفيش أخطاء، بس فيه ملاحظات محتاجة مراجعة (تحت).', className: 'warning' },
  problems: { text: 'فيه أخطاء لازم تتصلّح قبل التنفيذ (تحت).', className: 'error' },
} as const;

const SEVERITY_WORD = { error: 'خطأ', warning: 'تنبيه', info: 'ملاحظة' } as const;

/** Square metres with Arabic digits, e.g. "٨٠ م²". */
const squareMetres = (value: number) => formatArea(value * 100_000_000);

/**
 * The client report for one saved revision: plan, 3D picture, numbers, bill of materials and
 * issues, laid out for A4 paper. Printing uses the browser (save as PDF works too).
 */
export function ReportPage({ projectId }: { projectId: string }) {
  const [project, setProject] = useState<Project | null>(null);
  const [missing, setMissing] = useState(false);
  const [picture, setPicture] = useState<string | null | 'pending'>('pending');
  useEffect(() => {
    api
      .getProject(projectId)
      .then(setProject)
      .catch(() => setMissing(true));
  }, [projectId]);
  const report = useMemo(() => (project ? buildReport(project) : null), [project]);
  const issues = useMemo(() => (project ? checkProject(project) : []), [project]);
  useEffect(() => {
    if (!project) return;
    // Let the page paint first; drawing the 3D picture takes a moment on slow machines.
    const timer = setTimeout(() => setPicture(renderSnapshot(project, issues, 900, 520)), 30);
    return () => clearTimeout(timer);
  }, [project, issues]);
  useEffect(() => {
    if (report) document.title = `تقرير - ${report.name}`;
    return () => {
      document.title = 'مخطط المساحات';
    };
  }, [report]);

  if (missing) {
    return (
      <div className="page">
        <p>المشروع ده مش موجود.</p>
        <a href="#/" className="button">رجوع للمشاريع</a>
      </div>
    );
  }
  if (!project || !report) return <div className="page"><p className="muted">بيحمّل…</p></div>;

  const today = new Intl.DateTimeFormat('ar-EG', { dateStyle: 'long' }).format(new Date());
  const verdict = VERDICT[report.verdict];
  return (
    <div className="report" data-testid="report">
      <nav className="report-tools">
        <a href={`#/p/${project.id}`} className="button">رجوع للتصميم</a>
        <button type="button" className="primary" onClick={() => window.print()}>
          اطبع التقرير
        </button>
        <span className="muted">عشان تحفظه ملف: من شاشة الطباعة اختار الحفظ كملف بدل الطابعة.</span>
      </nav>

      <article className="sheet">
        <header className="report-head">
          <div>
            <h1>{report.name}</h1>
            <p className="muted">تقرير تجهيز المكان</p>
          </div>
          <dl className="report-meta">
            <div>
              <dt>التاريخ</dt>
              <dd>{today}</dd>
            </div>
            <div>
              <dt>رقم النسخة</dt>
              <dd data-testid="report-revision">{formatCount(report.revision)}</dd>
            </div>
          </dl>
        </header>

        <p className={`verdict ${verdict.className}`} data-testid="report-verdict">
          {verdict.text}
        </p>

        <section className="report-numbers" aria-label="الأرقام">
          <div>
            <span>الكراسي</span>
            <strong data-testid="report-seats">{formatCount(report.totals.seats)}</strong>
          </div>
          <div>
            <span>العناصر</span>
            <strong>{formatCount(report.totals.items)}</strong>
          </div>
          <div>
            <span>مساحة الأرض</span>
            <strong>{squareMetres(report.room.floorArea)}</strong>
          </div>
          <div>
            <span>المشغول بالعفش</span>
            <strong>
              {squareMetres(report.totals.occupiedArea)} ({formatPercent(report.totals.occupancy)})
            </strong>
          </div>
          <div>
            <span>نصيب الكرسي من الأرض</span>
            <strong>{report.totals.areaPerSeat === undefined ? '—' : squareMetres(report.totals.areaPerSeat)}</strong>
          </div>
        </section>

        <section className="report-section" aria-label="المخطط">
          <h2>المخطط من فوق</h2>
          <PlanDrawing project={project} issues={issues} keyOf={report.keyOf} width={900} height={560} />
          <p className="muted" data-testid="report-room">
            {[
              `القاعة ${formatLength(report.room.width)} × ${formatLength(report.room.depth)}`,
              report.room.ceiling === undefined ? 'ارتفاع السقف مش مكتوب' : `السقف ${formatLength(report.room.ceiling)}`,
              `الأبواب: ${formatCount(report.room.doors)}`,
              `الأعمدة: ${formatCount(report.room.columns)}`,
            ].join('، ')}
            . الأرقام على العناصر هي رقم الصنف في الجدول.
          </p>
        </section>

        <section className="report-section" aria-label="الشكل المجسم">
          <h2>الشكل المجسم</h2>
          {picture === 'pending' ? (
            <p className="muted">بيجهّز الصورة…</p>
          ) : picture ? (
            <img src={picture} alt="صورة مجسمة للقاعة" className="report-picture" data-testid="report-picture" />
          ) : (
            <p className="muted">المتصفح ده مش بيرسم مجسم؛ التقرير كامل من غير الصورة.</p>
          )}
        </section>

        <section className="report-section" aria-label="قائمة الكميات">
          <h2>قائمة الكميات</h2>
          {report.lines.length === 0 ? (
            <p className="muted">مفيش عناصر في التصميم لسه.</p>
          ) : (
            <table className="report-table" data-testid="report-bom">
              <thead>
                <tr>
                  <th>رقم</th>
                  <th>الصنف</th>
                  <th>المقاس (عرض × عمق × ارتفاع)</th>
                  <th>العدد</th>
                  <th>كراسي</th>
                </tr>
              </thead>
              <tbody>
                {report.lines.map((line) => (
                  <tr key={line.definitionId}>
                    <td>{formatCount(line.key)}</td>
                    <td>{line.name}</td>
                    <td>
                      {formatLength(line.size.w)} × {formatLength(line.size.d)} × {formatLength(line.size.h)}
                    </td>
                    <td>{formatCount(line.count)}</td>
                    <td>{line.seats > 0 ? formatCount(line.seats) : '—'}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td />
                  <td>الإجمالي</td>
                  <td />
                  <td>{formatCount(report.totals.items)}</td>
                  <td>{formatCount(report.totals.seats)}</td>
                </tr>
              </tfoot>
            </table>
          )}
        </section>

        <section className="report-section" aria-label="المراجعة">
          <h2>المراجعة</h2>
          {report.issues.length === 0 ? (
            <p>مفيش مشاكل.</p>
          ) : (
            <ul className="report-issues" data-testid="report-issues">
              {report.issues.map((issue, i) => (
                <li key={i} className={issue.severity}>
                  <strong>
                    {SEVERITY_WORD[issue.severity]}: {issue.title}
                  </strong>{' '}
                  {issue.text}
                </li>
              ))}
            </ul>
          )}
        </section>

        <footer className="report-foot">
          الفحص مبني على المقاسات المكتوبة في التصميم: التداخل، الحدود، فتحات الأبواب، الأعمدة، مساحة الاستخدام حوالين كل عنصر، وارتفاع السقف. مش بديل عن
          اشتراطات الدفاع المدني أو مراجعة مهندس.
        </footer>
      </article>
    </div>
  );
}
