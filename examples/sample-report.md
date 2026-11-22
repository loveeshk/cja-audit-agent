# CJA audit report

> **SAMPLE DATA.** This report was produced from built-in sample data, not from a real CJA environment.

Generated: 2026-11-22T19:47:03.210Z
Data view: SAMPLE - Web + Call Center DV (dv_sample0001)
Connection: SAMPLE - Web + Call Center (dg_sample-0001)

This audit is read-only: it made no changes to any CJA, Experience Platform or Adobe Analytics setting.

## Summary

| High | Medium | Low | Info |
|---|---|---|---|
| 7 | 7 | 5 | 9 |

## High (7)

### 1 backfill(s) failed for "SAMPLE Call Center Events"
`conn.backfill-failed` - connection

A failed backfill leaves a gap in historical data, and a backfill feed can only export data that CJA holds.

**Next step:** List the backfills for this dataset and check the status and date range of the failed ones.

```json
{
  "dataset": "SAMPLE Call Center Events",
  "total": 2,
  "failed": 1,
  "inProgress": 0,
  "completed": 1
}
```

### New data is not being imported for "SAMPLE Call Center Events"
`conn.import-new-data-off` - connection

The dataset reports streaming as off. In the connection settings this normally corresponds to importing all new data, so batches ingested later will not reach CJA or any data feed.

**Next step:** Confirm the "import all new data" setting for this dataset in the Connections interface.

```json
{
  "dataset": "SAMPLE Call Center Events",
  "dataSetId": "5f0000000000000000000002",
  "streaming": false
}
```

### User Agent / Mobile ID cannot be combined with these device columns
`feed.column-conflict` - feed

These dimensions cannot exist together in Experience Platform datasets, so they cannot share a feed.

**Next step:** Remove either the User Agent / Mobile ID column or the conflicting device columns.

```json
{
  "includes": [
    "user agent"
  ],
  "conflictsWith": [
    "browser"
  ]
}
```

### 1 column(s) cannot be included in a data feed
`feed.column-not-available` - feed

Adobe lists these components as not available in data feeds. Timestamp UTC is always included, so time breakdowns can usually be rebuilt downstream.

**Next step:** Remove them from the plan.

```json
[
  "Day"
]
```

### 1 metric(s) must be substituted
`feed.column-substitute` - feed

These metrics are exported through a count distinct of an ID column.

```json
[
  {
    "column": "Events",
    "use": "count distinct of Row ID"
  }
]
```

### 1 column(s) not found in the data view
`feed.column-unresolved` - feed

Only components that exist in the data view can be added to the feed.

**Next step:** Correct the spelling or use the suggested components.

```json
[
  {
    "column": "Page Nmae",
    "suggestions": [
      "Page Name",
      "Page URL"
    ]
  }
]
```

### The live feed starts in the past
`feed.live-start-past` - feed

A live feed must start today or later, and 2026-11-21 is before 2026-11-22. Use a backfill feed for historical data. Dates are read in the data view's time zone (America/New_York); this check compares them with today's UTC date.

## Medium (7)

### Event datasets use different identity namespaces
`conn.identity-namespace-mismatch` - connection

Datasets merge on the person ID value. Values from different namespaces rarely match, so journeys across these datasets can stay separate. This may be intentional.

**Next step:** If you expect one person across these sources, align the person ID or consider stitching.

```json
[
  {
    "dataset": "SAMPLE Web Events",
    "personIdField": "_sample.identity.ecid",
    "identityNamespace": "ECID"
  },
  {
    "dataset": "SAMPLE Call Center Events",
    "personIdField": "_sample.crm.email",
    "identityNamespace": "Email"
  }
]
```

### Lookup dataset "SAMPLE Product Lookup" has no key field
`conn.lookup-incomplete` - connection

Without a key field the lookup cannot be joined to event data, so its values stay empty in reports and feeds.

```json
{
  "dataset": "SAMPLE Product Lookup",
  "dataSetId": "5f0000000000000000000003"
}
```

### "SAMPLE Call Center Events" has not ingested data for 10 days
`conn.stale-ingestion` - connection

The last ingestion was more than 3 days ago. A live data feed will be empty or sparse while ingestion is stale.

**Next step:** Check recent batches for this dataset in Experience Platform, and the import setting in the connection.

```json
{
  "dataset": "SAMPLE Call Center Events",
  "lastIngestedTime": "2026-11-12T12:00:00.000Z",
  "ageDays": 10,
  "thresholdDays": 3
}
```

### 1 component name(s) are used more than once
`dv.duplicate-names` - dataview

When feed columns are picked by name it is ambiguous which component is meant.

**Next step:** Rename the duplicates in the data view so each name is distinct.

```json
[
  {
    "name": "Campaign",
    "components": [
      "dimension:variables/campaign",
      "dimension:variables/campaign2"
    ]
  }
]
```

### 2 component(s) report no data
`dv.no-data-components` - dataview

A feed column built on a component with no data would be empty.

**Next step:** Check whether the field is populated in the schema and in the connected datasets, or leave it out of the feed.

```json
{
  "count": 2,
  "components": [
    "dimension:Region",
    "metric:Revenue"
  ]
}
```

### 1 column(s) have no data
`feed.column-no-data` - feed

These columns would be empty.

```json
[
  "Region"
]
```

### Lookback (14 days) is shorter than the persistence of 1 column(s)
`feed.lookback-short` - feed

Persisted values older than the lookback are not seen when the feed is generated, so values can differ from Analysis Workspace.

**Next step:** Raise the lookback to at least 60 days, accepting slower deliveries.

```json
[
  {
    "dimension": "Campaign",
    "persistenceDays": 60
  }
]
```

## Low (5)

### Backfill is disabled for this connection
`conn.backfill-disabled` - connection

Historical data from before the connection was created is not imported, which limits what a backfill feed can export.

### The connection has no description
`conn.no-description` - connection

A description helps the next person understand which sources this connection combines.

### 11 of 14 dimensions have no description
`dv.missing-descriptions` - dataview

Descriptions help people choose the right columns.

### The data view has no description
`dv.no-description` - dataview

A description tells the next person what this data view is for.

### 1 component(s) are named like raw schema paths
`dv.raw-schema-names` - dataview

Feed columns take their names from data view components, so readable names make the files easier to use.

```json
[
  "_sample.customer.tier"
]
```

## Info (9)

### Person ID per event dataset
`conn.person-id-fields` - connection

SAMPLE Web Events: _sample.identity.ecid (ECID); SAMPLE Call Center Events: _sample.crm.email (Email)

### Data retention is 25 months
`conn.retention` - connection

A backfill feed must start inside the data retention window.

### 14 dimensions and 8 metrics
`dv.components-summary` - dataview

Feed columns come from these components, so only components that exist here can be selected.

### 1 dimension(s) use persistence
`dv.persistence-summary` - dataview

A feed's lookback date range bounds how far back persistence is evaluated.

```json
[
  {
    "dimension": "Campaign",
    "days": 60,
    "windowBased": false,
    "allocation": "ALLOCATION_FIRST_TOUCH"
  }
]
```

### Session settings returned
`dv.session` - dataview

{"note":"sample value","inactivityTimeoutMinutes":30}

### Time zone is America/New_York
`dv.timezone` - dataview

Daily feeds start and end at midnight in America/New_York, and feed dates are read in that time zone.

### Data feeds were labelled Limited Testing
`feed.availability` - feed

Confirm that the Data feeds tab exists under Components > Exports in your CJA environment before building this plan.

### Feed days run in America/New_York
`feed.timezone-boundary` - feed

Hourly windows and the dates above follow the data view's time zone.

### Feed name uniqueness and column overlap cannot be checked here
`feed.uniqueness-unchecked` - feed

No CJA API for listing data feeds was found, so existing feeds are not visible. Names must be unique within the data view, and feeds on the same data view need different column definitions.

## Planned feed columns

| Requested | Status | Notes |
|---|---|---|
| Page Name | ok |  |
| Marketing Channel | ok |  |
| variables/campaign | ok |  |
| Page Nmae | unresolved | Not found. Did you mean: Page Name, Page URL? |
| Day | not-available | Adobe lists this component as not available in data feeds. |
| Events | substitute | Not exportable as a metric. Use count distinct of Row ID. |
| User Agent | conflict | Conflicts with other device columns in this plan. |
| Browser | conflict | Conflicts with other device columns in this plan. |
| Region | no-data | The data view reports no data for this component. |
