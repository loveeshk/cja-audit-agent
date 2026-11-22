// audit/mock-data.js — SAMPLE data for demos and tests. Not real. Shaped like the CJA API
// responses the audit reads, with deliberate problems so every kind of finding can be shown
// without credentials. The UI labels anything from here as "sample data".

'use strict';

const clone = (x) => JSON.parse(JSON.stringify(x));

function build(now = new Date()) {
  const ago = (ms) => new Date(now.getTime() - ms).toISOString();
  const H = 3600000, D = 86400000;

  const connection = {
    id: 'dg_sample-0001',
    idWithoutPrefix: 'sample-0001',
    name: 'SAMPLE - Web + Call Center',
    description: '',
    isDeleted: false,
    isDisabled: false,
    backfillEnabled: false,
    dataRetentionMonths: 25,
    validationErrors: [],
    dataSets: [
      {
        dataSetId: '5f0000000000000000000001', type: 'event', name: 'SAMPLE Web Events',
        timestampId: 'timestamp', visitorId: '_sample.identity.ecid', identityNamespace: 'ECID',
        streaming: true, backfillSummary: { total: 1, failed: 0, inProgress: 0, completed: 1 },
        lastIngestedTime: ago(2 * H),
      },
      {
        dataSetId: '5f0000000000000000000002', type: 'event', name: 'SAMPLE Call Center Events',
        timestampId: 'timestamp', visitorId: '_sample.crm.email', identityNamespace: 'Email',
        streaming: false, backfillSummary: { total: 2, failed: 1, inProgress: 0, completed: 1 },
        lastIngestedTime: ago(10 * D),
      },
      { dataSetId: '5f0000000000000000000003', type: 'lookup', name: 'SAMPLE Product Lookup', streaming: true },
    ],
  };

  const dataView = {
    id: 'dv_sample0001',
    name: 'SAMPLE - Web + Call Center DV',
    description: '',
    parentDataGroupId: 'dg_sample-0001',
    timezoneDesignator: 'America/New_York',
    isDeleted: false,
    sessionDefinition: { note: 'sample value', inactivityTimeoutMinutes: 30 },
  };

  const d = (id, name, description, extra = {}) => ({ id: `variables/${id}`, name, description, hasData: true, dataSetType: 'event', ...extra });
  const dimensions = [
    d('page', 'Page Name', 'Name of the page viewed'),
    d('pageurl', 'Page URL', ''),
    d('daterangeday', 'Day', ''),
    d('daterangemonth', 'Month', ''),
    d('marketingchannel', 'Marketing Channel', 'Channel that brought the visit'),
    d('campaign', 'Campaign', '', {
      persistenceSetting: { enabled: true, allocationModel: { func: 'ALLOCATION_FIRST_TOUCH', expiration: { func: 'customTime', granularity: 'day', numPeriods: 60 } } },
    }),
    d('campaign2', 'Campaign', ''),
    d('useragent', 'User Agent', ''),
    d('browser', 'Browser', ''),
    d('mobiledevice', 'Mobile Device Name', ''),
    d('region', 'Region', '', { hasData: false }),
    d('_sample.customer.tier', '_sample.customer.tier', ''),
    d('callreason', 'Call Reason', 'Reason given on the call', { dataSetType: 'event' }),
    d('emaildomain', 'Email Domain', ''),
  ];
  const m = (id, name, extra = {}) => ({ id: `metrics/${id}`, name, hasData: true, dataSetType: 'event', sourceFieldType: 'integer', ...extra });
  const metrics = [
    m('pageviews', 'Page Views'),
    m('events', 'Events'),
    m('visitors', 'People'),
    m('visits', 'Sessions'),
    m('orders', 'Orders'),
    m('revenue', 'Revenue', { hasData: false }),
    m('timespent', 'Time Spent (seconds)'),
    m('callduration', 'Call Duration'),
  ];

  return { connection, dataView, dimensions, metrics };
}

// Same interface as the live client in cja-client.js
// `nowFn` is called on every request so the sample timestamps stay "recent" while the server runs.
function createMockSource(nowFn = () => new Date()) {
  const fresh = () => build(typeof nowFn === 'function' ? nowFn() : nowFn);
  return {
    source: 'mock',
    async listDataViews() {
      const data = fresh();
      return [{ id: data.dataView.id, name: data.dataView.name, parentDataGroupId: data.dataView.parentDataGroupId }];
    },
    async getDataView(id) {
      const data = fresh();
      if (id !== data.dataView.id) throw Object.assign(new Error('Sample data view not found'), { status: 404 });
      return { value: clone(data.dataView), notes: [] };
    },
    async getConnection(id) {
      const data = fresh();
      if (id !== data.connection.id) throw Object.assign(new Error('Sample connection not found'), { status: 404 });
      return { value: clone(data.connection), notes: [] };
    },
    async getComponents(id) {
      const data = fresh();
      if (id !== data.dataView.id) throw Object.assign(new Error('Sample data view not found'), { status: 404 });
      return { dimensions: clone(data.dimensions), metrics: clone(data.metrics), notes: [] };
    },
  };
}

module.exports = { createMockSource, build };
