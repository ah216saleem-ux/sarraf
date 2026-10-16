# Dynamic Economic News Calendar Date Progression & Interactive Date Navigation

Implementation plan for rolling real-time Economic Calendar date progression, interactive Date Selector Strip, and past/future event filtering in the News Tab.

## User Review & Critical Decisions

> [!IMPORTANT] Confirmed User Preferences
> The user confirmed the following behavior for the Economic Calendar date navigation and event lifecycle:
>
> 1. **Past Days Display**: Past news days are hidden by default to keep the calendar focused on active trading catalysts (Today + Upcoming Days). A quiet **"View Past Days / Archive"** toggle is provided for users who wish to inspect historical releases.
> 2. **Interactive Date Selector Strip**: A horizontal date strip (`TODAY`, `MON`, `TUE`, `WED`, `THU`, `FRI`, `SAT`, `SUN`) sits prominently above the calendar timeline, allowing instant jumping and date filtering.
> 3. **Multi-Week Rollover & Sync**: Automatic midnight 00:00 UTC rollover dynamically shifts elapsed events into the past bucket, advances the active day focus, and maintains continuous background synchronization with the Forex Factory feed.

---

## 1. Overview & Core Concept

### What It Does
This enhancement transforms the Economic Calendar in `NewsTab` into a dynamically auto-rolling, date-aware catalyst engine. As real-world days pass:
- The calendar automatically highlights **Today's Active Catalysts** and future upcoming days.
- Past events are neatly filtered out of the default view and accessible via an **Archive Toggle**.
- An interactive **Date Selector Strip** provides 1-tap filtering for specific days of the current and upcoming weeks.
- The `NewsFlow` animation canvas, Next Key Catalyst card, and Playbook dynamically align with the selected or current date.

### Target Audience & Persona
Gold (XAU/USD) institutional traders and retail scalpers relying on precision macroeconomic news timing, pre-news directional leans, and volatility locks.

---

## 2. User Experience & Visual Design

### Key User Flows

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    ECONOMIC CALENDAR (NEWS TAB)                         │
├─────────────────────────────────────────────────────────────────────────┤
│ [Risk Meter: MEDIUM RISK]  [AHMED AI: ONLINE]   [Feed: Forex Factory]   │
│                                                                         │
│  DATE SELECTOR STRIP (Interactive Horizontal Bar)                       │
│  [ ALL ]  [★ TODAY (OCT 16)]  [SAT 17]  [SUN 18]  [MON 19] ... [PAST]   │
│                                                                         │
│  NEWS FLOW ANIMATION CANVAS (Live Gold Streaming Nodes)                  │
│  [ Upcoming USD Catalyst Strands -> Gold Central Hub -> Lean Outcomes ]  │
│                                                                         │
│  NEXT KEY CATALYST CARD (Featured Highlighted Release)                  │
│  [ TIER 1 · Core CPI m/m · T-42m · Lean: BULLISH · Playbook ]            │
│                                                                         │
│  TIMELINE GROUPED BY DATE (Clean Unboxed Grouping)                      │
│  ├── TODAY, FRIDAY OCT 16 (Active Focus)                                │
│  │   └── 16:00 UTC · TIC Long-Term Purchases                            │
│  └── SUNDAY, OCT 18                                                     │
│      ├── 09:05 UTC · Core CPI m/m                                        │
│      └── 09:05 UTC · CPI y/y                                            │
│                                                                         │
│  [Show Past Events (34 Releases)]  <-- Unfolds past historical releases │
└─────────────────────────────────────────────────────────────────────────┘
```

1. **Date Selection**: Tapping a day on the Date Selector Strip (`TODAY`, `MON 19`, etc.) instantly filters the timeline and updates the active highlight. Tapping `ALL` displays the complete upcoming week. Tapping `PAST` unfolds historical releases.
2. **Real-Time Rollover**: At 00:00 UTC, elapsed events naturally transition into the past archive. `TODAY` shifts to the new current date, and upcoming events advance into view seamlessly.
3. **Synchronized Animation & Playbook**: Tapping any event on the Date Strip or timeline focuses the `NewsFlow` Canvas stream and loads the corresponding AHMED AI Brief and Playbook.

### Visual Identity & Theme
- **Theme**: Dark institutional slate (`#03050a` canvas, `#0a0e17` surface panels) with metallic gold (`#FFD97A` / `#E8B84A`) accents.
- **Date Selector Strip**: Clean segmented control styling with gold indicator pills for active day selection.
- **Typography**: Display headlines in `Bricolage Grotesque` / `Outfit`, data values and countdowns in tabular monospace (`font-mono tabular-nums`).

---

## 3. Key Product Decisions & Trade-Offs

### Decision 1: Default View Filtering (Upcoming vs. Past)
- **Chosen Approach**: Filter out past events from the main timeline by default, showing `TODAY` and future days in the upcoming 7-day window, with a dedicated toggle button to reveal `PAST` events.
- **Why**: Prevents clutter from completed events, allowing traders to focus on actionable market-moving catalysts.
- **Alternatives Considered**: Showing all past 30 days inline, which required excessive scrolling to reach today's active releases.

### Decision 2: Date Selector Strip Navigation
- **Chosen Approach**: A horizontal scrollable day selector strip at the top of the timeline (`ALL`, `TODAY`, day name + date number, and `PAST`). Tapping a date filters the view client-side with 0ms latency.
- **Why**: Gives traders instant 1-tap jump to any day in the economic calendar.

---

## 4. Technical Architecture & Data Strategy

### System Architecture Diagram

```
┌────────────────────────────────────────────────────────────────────────┐
│                          REACT FRONTEND (NewsTab)                      │
│                                                                        │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ DateSelectorStrip: [ ALL | TODAY | SAT | SUN | MON | ... | PAST ] │  │
│  └─────────────────────────────────┬────────────────────────────────┘  │
│                                    │ selectedDateFilter                │
│                                    ▼                                   │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ Event Filtering Engine (filters events by timeUtc & selectedDate)│  │
│  └─────────────────────────────────┬────────────────────────────────┘  │
│                                    │                                   │
│            ┌───────────────────────┴───────────────────────┐           │
│            ▼                                               ▼           │
│  ┌───────────────────────────┐               ┌──────────────────────┐  │
│  │ NewsFlow Canvas Animation │               │ Grouped Day Timeline │  │
│  └───────────────────────────┘               └──────────────────────┘  │
└────────────────────────────────────▲───────────────────────────────────┘
                                     │ Periodic Sync (60s)
                                     │ /api/news
┌────────────────────────────────────┴───────────────────────────────────┐
│                          EXPRESS SERVER (server.ts)                    │
│                                                                        │
│  getNewsEventsForUI() -> ensureUpcomingEvents() -> Forex Factory Sync   │
└────────────────────────────────────────────────────────────────────────┘
```

### Component & State Mapping

1. **`DateSelectorStrip.tsx`**:
   - Computes unique day keys from available events (`YYYY-MM-DD`).
   - Maintains `selectedDate` state (`'ALL' | 'TODAY' | 'PAST' | 'YYYY-MM-DD'`).
   - Renders single-line date buttons with day name (`MON`), day number (`19`), and event count badges.

2. **`NewsTab.tsx` Event Grouping**:
   - `todayKey`: Derived from `new Date().toISOString().slice(0, 10)`.
   - `upcomingEvents`: Events where `eventTs + 15 * 60000 >= now`.
   - `pastEvents`: Events where `eventTs + 15 * 60000 < now`.
   - Filtered timeline array dynamically recalculated whenever `selectedDate` or `events` change.

3. **Server Date Engine (`src/server/newsEngine.ts`)**:
   - `ensureUpcomingEvents()`: Continuously monitors `cachedEvents` against `Date.now()`.
   - Automatically maintains a rolling 7-day window of upcoming USD catalysts so that date rollover seamlessly pulls in new catalysts as real-world days progress.

---

## Pre-Flight Verification Plan

1. **Compilation Check**: Run `compile_applet` and `lint_applet` to verify TypeScript types and zero syntax errors.
2. **Date Selector Verification**: Test date filtering across `TODAY`, individual week days, `ALL`, and `PAST`.
3. **Rollover Verification**: Verify countdowns, day boundaries, and timestamp math respond accurately to real-time `Date.now()`.
