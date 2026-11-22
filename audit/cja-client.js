// audit/cja-client.js — READ-ONLY client for the CJA API calls the audit needs.
//
// Every request here is a GET. Nothing in the audit creates, edits or deletes anything.
// Extra fields are requested through the documented `expansion` parameter. If Adobe rejects
// an expansion list (HTTP 400/422), the client retries with a smaller list and records a note,
// so the audit can say which checks were skipped instead of failing.

'use strict';

const { createMockSource } = require('./mock-data');

function qs(params) {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) {
    if (v !== undefined && v !== null && v !== '') u.set(k, String(v));
  }
  const s = u.toString();
  return s ? `?${s}` : '';
}

function createLiveSource(cjaApiRequest) {
  // Try each expansion list from richest to smallest.
  async function getWithFallback(path, expansions, extra = {}) {
    const notes = [];
    let lastErr;
    for (let i = 0; i < expansions.length; i++) {
      try {
        const value = await cjaApiRequest(`${path}${qs({ ...extra, expansion: expansions[i] })}`);
        if (i > 0) notes.push(`Adobe rejected the full expansion list for ${path}; retried with fewer fields, so some checks were skipped.`);
        return { value, notes };
      } catch (err) {
        lastErr = err;
        if (![400, 422].includes(err.status)) throw err;
      }
    }
    throw lastErr;
  }

  async function paged(path, expansions, key = 'content') {
    const first = await getWithFallback(path, expansions);
    let items = first.value[key] || (Array.isArray(first.value) ? first.value : []);
    const notes = [...first.notes];
    const totalPages = Number(first.value.totalPages) || 1;
    // Only follow pages if the API honours the page parameter (guard against ignoring it).
    for (let page = 1; page < Math.min(totalPages, 20); page++) {
      const next = await cjaApiRequest(`${path}${qs({ page })}`).catch(() => null);
      const more = next && (next[key] || []);
      if (!more || !more.length || (items[0] && more[0] && more[0].id === items[0].id)) {
        notes.push(`Only the first page of ${path} could be read (${items.length} of the listed total).`);
        break;
      }
      items = items.concat(more);
    }
    return { items, notes };
  }

  return {
    source: 'live',

    async listDataViews() {
      const { items } = await paged('/data/dataviews', ['name,description,parentDataGroupId,timezoneDesignator,isDeleted', 'name,parentDataGroupId', 'name']);
      return items.map((v) => ({ id: v.id, name: v.name, parentDataGroupId: v.parentDataGroupId }));
    },

    getDataView(id) {
      return getWithFallback(`/data/dataviews/${encodeURIComponent(id)}`, [
        'name,description,owner,isDeleted,parentDataGroupId,timezoneDesignator,sessionDefinition,modified,createdDate',
        'name,description,parentDataGroupId,timezoneDesignator',
        'name,parentDataGroupId',
        '',
      ]);
    },

    getConnection(id) {
      return getWithFallback(`/data/connections/${encodeURIComponent(id)}`, [
        'name,description,owner,isDeleted,isDisabled,dataSets,backfillEnabled,backfillsSummaryDataSets,dataSetLastIngested,dataRetentionMonths,validationErrors',
        'name,description,isDeleted,isDisabled,dataSets,backfillEnabled,dataRetentionMonths',
        'name,description,dataSets',
        '',
      ]);
    },

    async getComponents(dataViewId) {
      const base = `/data/dataviews/${encodeURIComponent(dataViewId)}`;
      const [dims, mets] = await Promise.all([
        paged(`${base}/dimensions`, [
          'description,sourceFieldName,schemaPath,hasData,hidden,approved,dataSetType,type,persistenceSetting,isDeleted',
          'description,hasData,dataSetType',
          '',
        ]),
        paged(`${base}/metrics`, ['description,hasData,dataSetType,sourceFieldType,isDeleted', 'hasData', '']),
      ]);
      return { dimensions: dims.items, metrics: mets.items, notes: [...dims.notes, ...mets.notes] };
    },
  };
}

// Chooses the data source: AUDIT_SOURCE=live|mock, otherwise live when S2S credentials exist.
function chooseSource(cjaApiRequest) {
  const wanted = (process.env.AUDIT_SOURCE || '').toLowerCase();
  const hasCreds = Boolean(process.env.ADOBE_S2S_CLIENT_ID && process.env.ADOBE_S2S_CLIENT_SECRET && process.env.ADOBE_ORG_ID);
  if (wanted === 'mock' || (wanted !== 'live' && !hasCreds)) return createMockSource();
  return createLiveSource(cjaApiRequest);
}

module.exports = { createLiveSource, chooseSource, qs };
