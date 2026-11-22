# CJA reference notes for the audit assistant (not indexed)

These notes paraphrase Adobe's public documentation for Customer Journey Analytics (CJA) and add the audit tool's own guidance. Sections whose title starts with "Audit tool note" are not Adobe documentation. The data feed pages carried a Limited Testing notice when they were last checked (2026-10-26), so confirm the feature and its current rules in your organisation before relying on them.

# Data feeds overview

## What a CJA data feed is

A CJA data feed exports raw data out of Customer Journey Analytics so it can be used in platforms outside Adobe. Files are delivered in hourly batches at the end of each hour, or in daily batches at the end of each day. A feed is built on a data view, so the columns that can be exported come from that data view.

Source: https://experienceleague.adobe.com/en/docs/analytics-platform/using/cja-components/exports/cja-data-feeds/data-feed-overview

## Prerequisites for data feeds

Before creating a feed you need a working implementation with data already being ingested into CJA. Your account must be an Analytics product admin, or belong to a product profile that has access to data feeds. You also need a cloud bucket configured on Amazon S3, Google Cloud Platform, Azure RBAC or Azure SAS.

Source: https://experienceleague.adobe.com/en/docs/analytics-platform/using/cja-components/exports/cja-data-feeds/data-feed-overview

## Availability of data feeds

The overview, comparison and create-feed pages all carried a notice that the functionality was in the Limited Testing phase of release and might not be available yet in every environment. A feed option that is missing in the interface may therefore be an availability matter and not a configuration error.

Source: https://experienceleague.adobe.com/en/docs/analytics-platform/using/cja-components/exports/cja-data-feeds/data-feed-overview

# Comparing CJA and Adobe Analytics data feeds

## Where the feed columns come from

In a CJA feed the schema follows the data view configuration, and the components you can include are a subset of the components in the data view. The feed builder uses the same component rail as Analysis Workspace, with named dimensions and metrics. An Adobe Analytics feed instead uses a fixed list of roughly 1,100 or more variables chosen by raw variable name, and many columns are exported as pre-processed and post-processed pairs such as eVar1 and post_eVar1.

Source: https://experienceleague.adobe.com/en/docs/analytics-platform/using/cja-components/exports/cja-data-feeds/df-comparison

## Output format and file paths

CJA feeds are delivered as Parquet files, which keep structured data (for example product lists) as nested objects, and they use Hive-style partition paths. Reading Parquet needs a Parquet-aware tool such as BigQuery, Snowflake or Apache Spark. Adobe Analytics feeds are delivered as TSV files in a flat directory, with complex fields encoded as delimited strings.

Source: https://experienceleague.adobe.com/en/docs/analytics-platform/using/cja-components/exports/cja-data-feeds/df-comparison

## Features that exist only in CJA feeds

CJA feeds support derived fields, stitching, segmentation, lookups embedded directly in the data, and five persistence models (Original, Most Recent, All, First-Known and Last-Known). Segments applied to the data view are inherited by the feed, and more segments can be added to the feed itself. Changes to components in the data view, such as renaming or removing a dimension, flow into future feeds and are also reflected in backfills. Adobe Analytics feeds have none of these, and offer only first-touch and last-touch persistence.

Source: https://experienceleague.adobe.com/en/docs/analytics-platform/using/cja-components/exports/cja-data-feeds/df-comparison

## When data is processed

CJA processes data at report time, so reporting features such as stitching, derived fields and segmentation can change historical data. Adobe Analytics processes data at collection time, so processing rules and VISTA rules do not change history. In CJA, sessions are defined in the data view. In Adobe Analytics they are defined at collection time.

Source: https://experienceleague.adobe.com/en/docs/analytics-platform/using/cja-components/exports/cja-data-feeds/df-comparison

## Delivery frequency, late hits and ordering

Both products offer daily feeds (midnight to midnight, in the data view's time zone for CJA and the report suite's time zone for Adobe Analytics) and hourly feeds. In CJA the processing delay setting controls how long the system waits after a frequency window closes before exporting, so that late-arriving hits can be captured. CJA accepts streaming and batch data, so events for a person are not guaranteed to arrive in timestamp order, and the order of hits inside a delivery is not guaranteed. The system that consumes the feed must tolerate out-of-order timestamps per person.

Source: https://experienceleague.adobe.com/en/docs/analytics-platform/using/cja-components/exports/cja-data-feeds/df-comparison

## Backfill window and destinations

A CJA backfill is limited to the connection's rolling data window. An Adobe Analytics backfill is limited to report suite retention, 25 months by default. CJA feeds can be delivered to Amazon S3, Azure RBAC, Azure SAS and Google Cloud Platform. Adobe Analytics feeds can also be delivered over SFTP, which CJA feeds do not list.

Source: https://experienceleague.adobe.com/en/docs/analytics-platform/using/cja-components/exports/cja-data-feeds/df-comparison

# Creating a data feed

## Details tab

A feed name must be unique within the selected data view and can be up to 255 characters. The description can be up to 500 characters. You pick the data view that contains the data to export. If several feeds are created on the same data view, each one must have different column definitions. The list of available columns depends on the login company that owns the data view, so changing the data view can change the list.

Source: https://experienceleague.adobe.com/en/docs/analytics-platform/using/cja-components/exports/cja-data-feeds/create-feed

## Data structure tab

On this tab you choose segments and add components. Several segments are combined with AND, and an OR needs a new segment built in the segment builder. Segments added here apply in addition to segments already applied in the data view. The component rail shows only components that are valid for feeds. Components that belong to an XDM array field appear as nested groups and are exported as nested arrays. The order of components on the canvas becomes the column order in the file, and a component's displayed ID can be changed. The schema preview and the example rows dialog show structure only, and the example rows are not your real data.

Source: https://experienceleague.adobe.com/en/docs/analytics-platform/using/cja-components/exports/cja-data-feeds/create-feed

## Columns that are always included in a feed

Timestamp UTC, Row ID, Session ID and Person ID are included in every feed and cannot be removed. Timestamp UTC supports sub-second precision. In B2B Edition, Account ID is also included when the Account container is used. Because these are automatic, they do not need to be added as columns.

Source: https://experienceleague.adobe.com/en/docs/analytics-platform/using/cja-components/exports/cja-data-feeds/create-feed

## Columns that are not available in a feed

The standard time-based dimensions cannot be included: 5 Minute, 15 Minute, 30 Minute, Day, Day of Week, Day of Month, Hour, Hour of Day, Minute, Minute of Hour, Month, Month of Year, Quarter, Quarter of Year, Second, Week, Week of Year and Year. Several optional standard components are also not available: AM/PM, Day of Year, Session Type, Time Spent per Event, Time Spent per Session, Time Spent per Person, Weekend/Weekday, and the metrics First-time Sessions, Return Sessions and Repeat Session. The profile and union metrics (Adobe Visitors Profile, Adobe Persons Union and Profile, and the Opportunities, Accounts, Buying Groups and Global Accounts equivalents) cannot be included, and neither can Session Starts, Session Ends and Time Spent (seconds). Timestamp UTC is always included, so time-based breakdowns can usually be rebuilt downstream from it (that suggestion is the audit tool's, not Adobe's).

Source: https://experienceleague.adobe.com/en/docs/analytics-platform/using/cja-components/exports/cja-data-feeds/create-feed

## Metrics that must be substituted in a feed

Some metrics cannot be exported directly and are replaced by a count distinct of an ID column. Events becomes count distinct of Row ID. People becomes count distinct of Person ID. Sessions becomes count distinct of Session ID. Conversations becomes count distinct of Conversation ID. In B2B Edition, Accounts, Buying Group, Global Accounts and Opportunities become count distinct of their respective ID.

Source: https://experienceleague.adobe.com/en/docs/analytics-platform/using/cja-components/exports/cja-data-feeds/create-feed

## Columns that cannot be combined in a feed

Certain dimensions cannot exist together in Experience Platform datasets, so they cannot be in the same feed. If a feed includes the User Agent or Mobile ID dimension, then these dimensions cannot be added: Browser Type, Browser, Mobile Manufacturer, Mobile Device Type, Mobile Audio Support, Mobile DRM, Mobile Java VM, Mobile Information Services, Mobile Image Support, Mobile Color Depth, Mobile Net Protocols, Mobile Device Number, Mobile Max Email Length, Mobile Mail Decoration, Mobile Push To Talk, Mobile Screen Width, Mobile Max Browser URL Length, Mobile Operating System (deprecated), Mobile Screen Height, Mobile Video Support, Mobile Cookie Support, Mobile Max Bookmark Length, Mobile Screen Size, Mobile Device Name, Operating System Types and Operating Systems. With the Web SDK this restriction is enforced in the datastream before data reaches Experience Platform.

Source: https://experienceleague.adobe.com/en/docs/analytics-platform/using/cja-components/exports/cja-data-feeds/create-feed

## Feed type, start date and end date

A live feed exports current and future data. A backfill feed exports historical data. For a live feed the start date must be today or a future date, and an expiration date can be set. For a backfill feed the start date must be a past date that falls inside the data view's data retention window, and the end date cannot be in the future. All of these dates are based on the data view's time zone.

Source: https://experienceleague.adobe.com/en/docs/analytics-platform/using/cja-components/exports/cja-data-feeds/create-feed

## Feed frequency

Daily feeds contain a full day of data, midnight to midnight in the data view's time zone. Daily is required for backfill feeds and optional for live feeds. Hourly feeds contain one hour of data and are available for live feeds only. For a backfill feed the frequency field is locked to daily.

Source: https://experienceleague.adobe.com/en/docs/analytics-platform/using/cja-components/exports/cja-data-feeds/create-feed

## Lookback date range

The frequency window decides which events are included in a delivery, and the lookback date range supplies the history needed to classify those events correctly. The default is 30 days. Segment qualification, session boundaries, dimension persistence and derived field functions that reference containers are all calculated using data inside the lookback range. A longer range usually gives more accurate data, and a shorter range gives faster deliveries. If a dimension's persistence expires after the Person Reporting Window, the lookback range becomes its reporting window. If persistence uses a custom time that is longer than the lookback range, the custom time is ignored and the lookback range is used. For the most accurate values, set the lookback range equal to or longer than the persistence set on your dimensions. Differences between the lookback treatment and Analysis Workspace can cause discrepancies between feed deliveries and Workspace reports.

Source: https://experienceleague.adobe.com/en/docs/analytics-platform/using/cja-components/exports/cja-data-feeds/create-feed

## Processing delay

The processing delay is how long CJA waits before processing a feed file, and the default is 2 hours. Late-arriving events that come in during the delay are included. It helps with mobile devices that come online later and with your own server-side processes. CJA picks a delay dynamically from how long late events usually take for your feed, and you can set it manually to 2, 3, 4 or 8 hours. A session must start after the processing delay cutoff to be included, so a session that starts before the cutoff and ends during the delay is not included.

Source: https://experienceleague.adobe.com/en/docs/analytics-platform/using/cja-components/exports/cja-data-feeds/create-feed

## Compression, destination and manifest

Feed files are Parquet and can be compressed with Snappy, GZip or Zstandard. Snappy is fast and widely supported by BigQuery, Snowflake and Spark, GZip is the most broadly compatible, and Zstandard gives high compression with fast decompression. The destination uses a cloud account and a location configured under Components > Exports in CJA. Accounts you configure are tied to your user unless you share them with your organisation. You can list email addresses to be told when a delivery succeeds or fails, and you can choose to include a manifest file with each delivery that describes the files in it.

Source: https://experienceleague.adobe.com/en/docs/analytics-platform/using/cja-components/exports/cja-data-feeds/create-feed

# Connections

## What a connection does

A connection defines which Experience Platform datasets (event, lookup, profile and summary datasets) are ingested into CJA. Connections are the foundation of CJA and decide which fields can be defined in a data view as dimensions or metrics. Several datasets can be combined in one connection. Access to connection management should be limited to a core group, because connection settings affect the volume of data brought into CJA.

Source: https://experienceleague.adobe.com/en/docs/analytics-platform/using/cja-connections/overview

## Person ID and dataset settings

Each event dataset in a connection is given a person ID field. When the same person ID is chosen across the event datasets of a connection, the datasets are merged on that identifier. Each dataset also has an option to import all new data, which keeps newly ingested batches flowing into CJA. After a connection is created it can take a few hours before data becomes available.

Source: https://experienceleague.adobe.com/en/docs/platform-learn/tutorial-one-adobe/reporting/cjab2c/cja1/ex2

## Stitching

CJA supports field-based stitching and graph-based stitching to improve cross-channel analysis for event datasets that are not fully populated with a usable identifier. Stitching applies to one dataset at a time. Merging datasets is a different thing, and happens when the same person ID is selected across the datasets of a connection. Stitching is enabled in the Connections interface and is applied on the fly as data from that dataset is ingested.

Source: https://experienceleague.adobe.com/docs/analytics-platform/using/stitching/overview.html

## Connections API fields

The connections API returns all connections with GET /data/connections and one connection with GET /data/connections/{id}. Viewing all connections needs product administration privileges. Optional fields such as dataSets, backfillEnabled, dataRetentionMonths, validationErrors, dataSetLastIngested and backfill summaries are returned only when requested with the expansion parameter. Each entry in dataSets can include dataSetId, type, timestampId, visitorId (the person ID field), identityNamespace, identityMap, streaming, lookupKeyField for lookup datasets, a backfillSummary with total, failed, inProgress and completed counts, and lastIngestedTime. A separate endpoint lists the backfills for one dataset in a connection with their status.

Source: https://developer.adobe.com/cja-apis/docs/endpoints/connections

# Data views

## How data view settings affect a feed

The data view decides the feed's columns, so renaming, hiding or removing a component changes later feeds. The data view's time zone sets where each daily feed starts and ends. Sessions are calculated from the data view's session settings. Segments applied to the data view are inherited by the feed. Persistence settings on dimensions are applied at report time when the feed is generated.

Source: https://experienceleague.adobe.com/en/docs/analytics-platform/using/cja-components/exports/cja-data-feeds/df-comparison

## Data views API fields

GET /data/dataviews lists data views and GET /data/dataviews/{id} returns one. Extra fields are returned only when requested through the expansion parameter. Documented expansion values include name, description, owner, isDeleted, parentDataGroupId, segmentList, currentTimezoneOffset, timezoneDesignator, modified, createdDate, organization, curationEnabled, recentRecordedAccess, sessionDefinition, externalData and containerNames.

Source: https://developer.adobe.com/cja-apis/docs/endpoints/dataviews

## Dimensions and metrics API fields

GET /data/dataviews/{id}/dimensions lists a data view's dimensions and GET /data/dataviews/{id}/metrics lists its metrics. A dimension can include id, name, description, sourceFieldName, schemaPath, type, dataSetType, hasData, hidden, approved, segmentable, multiValued, persistenceSetting and isDeleted. A metric can include id, name, dataSetType, sourceFieldType, hasData and derivedFieldCompatible. The hasData field reports whether the component contains data. Adobe notes that fields may be added to responses at any time, so integrations should ignore fields they do not understand.

Source: https://developer.adobe.com/cja-apis/docs/endpoints/dimensions/

# API access

## Credentials and permissions

To call the CJA APIs you create a project in the Adobe Developer Console, add the Customer Journey Analytics API and the Adobe Experience Platform API, and select the product profiles that grant access. You must be added as a Developer for the organisation. Each request carries the API key, the IMS organisation ID and a bearer token in its headers. Read-only GET requests are the safest way to start.

Source: https://experienceleague.adobe.com/en/perspectives/your-first-steps-with-adobe-customer-journey-analytics-apis

## The User region is missing error

This project's own setup notes record that CJA reporting calls can fail with the message "User region is missing" even though authentication succeeds, when the Adobe Experience Platform API has not been added to the same Server-to-Server credential as the Customer Journey Analytics API. Adding the Experience Platform API to the credential and selecting the product profiles fixes it.

Source: this project's README.md

# Audit tool notes: connection checks

## Audit tool note: conn.no-event-dataset

The connection has datasets but none is an event dataset. Reports and data feeds are built from event data, so this usually means the wrong datasets were added or the dataset type was set incorrectly. Open the connection and check the dataset types.

## Audit tool note: conn.import-new-data-off

An event dataset reports that streaming is off. In the connection settings this normally corresponds to the option that imports all new data. With it off, batches ingested after the connection was set up are not added, so reports and feeds stop receiving fresh data for that dataset. Confirm the setting in the Connections interface before changing it, because connection settings affect data volume.

## Audit tool note: conn.backfill-failed

At least one backfill for a dataset failed. Data before the connection was created, or data a backfill was meant to add, is incomplete for that dataset. A backfill feed can only export data that CJA holds, so a failed backfill leaves gaps. List the backfills for the dataset and look at their status and date range.

## Audit tool note: conn.stale-ingestion

The last ingestion time for an event dataset is older than the threshold. Either the source has stopped sending data, ingestion into Experience Platform is failing, or new data is not being imported into CJA. Check the dataset's batches in Experience Platform and the import setting in the connection. A live data feed will deliver empty or sparse files while ingestion is stale.

## Audit tool note: conn.identity-namespace-mismatch

Event datasets in the same connection use different identity namespaces for the person ID. Datasets merge on the person ID value, so values from different namespaces rarely match, and journeys across those datasets stay separate. This can be intentional, but check it when you expect one person across web and offline data. Stitching may be the better tool when only some events have an identifier.

## Audit tool note: conn.timestamp-missing

An event dataset has no timestamp field configured. Events need a timestamp to be placed on a timeline, and Timestamp UTC is a required column in every data feed.

## Audit tool note: conn.validation-errors

The connection reports validation errors, such as a field that is missing or not allowed in a dataset. Fix these in the connection first, because a data view built on a connection with errors may be missing components.

## Audit tool note: conn.lookup-incomplete

A lookup dataset has no key field configured, so it cannot be joined to the event data. Lookup values stay empty in reports and in feeds until the key and parent fields are set.

## Audit tool note: conn.retention

The connection's data retention in months limits how far back a backfill feed can start, since a backfill start date must fall inside the data retention window.

# Audit tool notes: data view checks

## Audit tool note: dv.no-connection

The data view is not linked to a connection through parentDataGroupId, or the linked connection cannot be read. Without a connection the data view has no data, and the connection checks cannot run. A data view's parentDataGroupId points to its connection, and connection IDs start with dg_.

## Audit tool note: dv.timezone

The data view's time zone decides where each daily feed starts and ends and how start and end dates are read. If downstream systems expect a different time zone, daily files will appear to be cut at the wrong time, so confirm the time zone before creating a feed.

## Audit tool note: dv.duplicate-names

Two or more components share a name. When choosing feed columns by name it is ambiguous which one is meant, and the feed builder shows them as separate items. Rename them in the data view so each column has a distinct, descriptive name.

## Audit tool note: dv.no-data-components

Some components report hasData as false. A feed column built on such a component would be empty. Check whether the field is populated in the schema and in the connected datasets, or leave the component out of the feed.

## Audit tool note: dv.raw-schema-names

Component names look like raw schema paths instead of readable names. Feed columns take their names from data view components, so readable names make the files easier to use downstream.

## Audit tool note: dv.persistence

Dimensions with persistence expire values after a time. A feed's lookback date range, 30 days by default, bounds how far back persistence is evaluated, so a persistence period longer than the lookback can make feed values differ from what Analysis Workspace shows. Raise the lookback to at least the longest persistence you rely on, accepting slower deliveries.

# Audit tool notes: planned feed checks

## Audit tool note: feed.column-unresolved

A requested column does not match any component in the data view by ID or by name. Check spelling, check whether the component is hidden or deleted, and use the suggested close matches. A column that is not in the data view cannot be added to the feed.

## Audit tool note: feed.column-not-available

The requested column is one of the components Adobe documents as unavailable in data feeds, such as time-based dimensions like Day or Month. The timestamp column already carries the time, so rebuild these downstream.

## Audit tool note: feed.column-substitute

The requested metric must be replaced. Events, People, Sessions and similar metrics are exported through count distinct of the corresponding ID column, for example Row ID, Person ID or Session ID, instead of as metric columns.

## Audit tool note: feed.column-conflict

The plan includes User Agent or Mobile ID together with device dimensions that cannot coexist with them. Remove either the User Agent or Mobile ID column, or the conflicting device dimensions, as listed in the finding.

## Audit tool note: feed.backfill-dates

Backfill feeds export history in daily chunks. The start date must be in the past and inside the data retention window, and the end date cannot be in the future. Live feeds need a start date of today or later.

## Audit tool note: feed.lookback-short

The lookback date range is shorter than the persistence of at least one requested dimension, so persisted values older than the lookback are not seen when the feed is generated. Lengthen the lookback or accept that those values will differ from reports.

## Audit tool note: feed.processing-delay

Processing delay values that Adobe lists for manual selection are 2, 3, 4 and 8 hours. Use a longer delay if late-arriving data, such as events from offline mobile apps, is common, and remember that sessions starting before the cutoff and ending during the delay are not included.

## Audit tool note: feed.availability

The data feed documentation was labelled Limited Testing. Before building a plan, confirm that the Data feeds tab appears under Components > Exports in your CJA environment.

## Audit tool note: feed.uniqueness-unchecked

No CJA API for listing or creating data feeds was found in Adobe's published API documentation, so the audit cannot see existing feeds. The rule that each feed on the same data view must have different column definitions, and that names must be unique within the data view, has to be checked in the CJA interface under Components > Exports > Data feeds.
