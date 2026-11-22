// audit/report.js — summaries and the downloadable Markdown report.

'use strict';

const { SEVERITY_ORDER } = require('./checks');

function summarize(findings) {
  const counts = { high: 0, medium: 0, low: 0, info: 0 };
  for (const f of findings) if (counts[f.severity] !== undefined) counts[f.severity]++;
  return { ...counts, total: findings.length };
}

const fence = (obj) => '```json\n' + JSON.stringify(obj, null, 2).slice(0, 1500) + '\n```';

function renderMarkdown({ title, source, generatedAt, target, findings = [], skipped = [], notes = [], columns = null, explanation = null }) {
  const sorted = [...findings].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  const sum = summarize(sorted);
  const out = [];
  out.push(`# ${title || 'CJA audit report'}`, '');
  if (source === 'mock') out.push('> **SAMPLE DATA.** This report was produced from built-in sample data, not from a real CJA environment.', '');
  out.push(`Generated: ${generatedAt || new Date().toISOString()}`);
  if (target?.dataView) out.push(`Data view: ${target.dataView.name || ''} (${target.dataView.id})`);
  if (target?.connection) out.push(`Connection: ${target.connection.name || ''} (${target.connection.id})`);
  out.push('', 'This audit is read-only: it made no changes to any CJA, Experience Platform or Adobe Analytics setting.', '');
  out.push(`## Summary`, '', `| High | Medium | Low | Info |`, `|---|---|---|---|`, `| ${sum.high} | ${sum.medium} | ${sum.low} | ${sum.info} |`, '');

  for (const sev of ['high', 'medium', 'low', 'info']) {
    const group = sorted.filter((f) => f.severity === sev);
    if (!group.length) continue;
    out.push(`## ${sev[0].toUpperCase() + sev.slice(1)} (${group.length})`, '');
    for (const f of group) {
      out.push(`### ${f.title}`, `\`${f.id}\` - ${f.area}`, '', f.detail, '');
      if (f.fix) out.push(`**Next step:** ${f.fix}`, '');
      if (f.evidence) out.push(fence(f.evidence), '');
    }
  }

  if (columns?.length) {
    out.push('## Planned feed columns', '', '| Requested | Status | Notes |', '|---|---|---|');
    for (const c of columns) out.push(`| ${c.requested} | ${c.status} | ${(c.notes || []).join(' ').replace(/\|/g, '/')} |`);
    out.push('');
  }
  if (skipped.length) out.push('## Checks that were skipped', '', ...skipped.map((s) => `- ${s}`), '');
  if (notes.length) out.push('## Notes', '', ...notes.map((s) => `- ${s}`), '');
  if (explanation?.markdown) {
    out.push('## Explanation (grounded in the CJA reference notes)', '', explanation.markdown, '');
    if (explanation.sources?.length) {
      out.push('### Sources used', '', ...explanation.sources.map((s) => `- [${s.n}] ${s.section} (notes lines ${s.lines}, match ${s.score})`), '');
    }
  }
  return out.join('\n');
}

module.exports = { summarize, renderMarkdown };
