import React from 'react';
import { Calendar, Clock, History, Filter } from 'lucide-react';

export interface DateDayItem {
  dayKey: string; // YYYY-MM-DD
  dayName: string; // e.g., 'MON', 'TUE', 'TODAY'
  dayDateStr: string; // e.g., '19 OCT'
  isToday: boolean;
  count: number;
}

interface DateSelectorStripProps {
  selectedFilter: string; // 'UPCOMING' | 'TODAY' | 'ALL' | 'PAST' | YYYY-MM-DD
  onSelectFilter: (filter: string) => void;
  dayItems: DateDayItem[];
  upcomingCount: number;
  todayCount: number;
  pastCount: number;
  totalCount: number;
}

export const DateSelectorStrip: React.FC<DateSelectorStripProps> = ({
  selectedFilter,
  onSelectFilter,
  dayItems,
  upcomingCount,
  todayCount,
  pastCount,
  totalCount,
}) => {
  return (
    <div className="w-full space-y-2">
      <div className="flex items-center justify-between text-xs px-1">
        <span className="font-bold text-neutral-400 uppercase tracking-wider flex items-center gap-1.5 text-[11px]">
          <Calendar className="w-3.5 h-3.5 text-[#FFD97A]" />
          DATE SELECTOR & TIMELINE FILTER
        </span>
        <span className="text-[10px] text-neutral-500 hidden sm:inline">
          Live 00:00 UTC rollover active
        </span>
      </div>

      {/* Horizontal Scrollable Day Strip */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-2 pt-0.5 no-scrollbar scroll-smooth">
        {/* Button 1: UPCOMING (Today + Future) */}
        <button
          onClick={() => onSelectFilter('UPCOMING')}
          className={`px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap shrink-0 transition-all flex items-center gap-1.5 cursor-pointer border ${
            selectedFilter === 'UPCOMING'
              ? 'bg-[#E8B84A]/20 border-[#E8B84A] text-[#FFD97A] shadow-[0_0_12px_rgba(232,184,74,0.2)]'
              : 'bg-black/40 border-white/10 text-neutral-400 hover:text-white hover:bg-white/5'
          }`}
        >
          <Clock className="w-3 h-3 text-[#FFD97A]" />
          <span>UPCOMING</span>
          <span className="px-1.5 py-0.2 rounded-full bg-white/10 text-[10px] font-mono">
            {upcomingCount}
          </span>
        </button>

        {/* Button 2: TODAY ONLY */}
        <button
          onClick={() => onSelectFilter('TODAY')}
          className={`px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap shrink-0 transition-all flex items-center gap-1.5 cursor-pointer border ${
            selectedFilter === 'TODAY'
              ? 'bg-[#FFD97A]/25 border-[#FFD97A] text-[#FFD97A] shadow-[0_0_12px_rgba(255,217,122,0.25)]'
              : 'bg-black/40 border-white/10 text-neutral-400 hover:text-white hover:bg-white/5'
          }`}
        >
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span>TODAY</span>
          <span className="px-1.5 py-0.2 rounded-full bg-white/10 text-[10px] font-mono">
            {todayCount}
          </span>
        </button>

        {/* Individual Upcoming Days (Mon, Tue, Wed...) */}
        {dayItems.map((day) => {
          const isSelected = selectedFilter === day.dayKey;

          return (
            <button
              key={day.dayKey}
              onClick={() => onSelectFilter(day.dayKey)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap shrink-0 transition-all flex items-center gap-1.5 cursor-pointer border ${
                isSelected
                  ? 'bg-[#E8B84A]/20 border-[#E8B84A] text-[#FFD97A] shadow-[0_0_12px_rgba(232,184,74,0.2)]'
                  : 'bg-black/40 border-white/10 text-neutral-400 hover:text-white hover:bg-white/5'
              }`}
            >
              <span>
                {day.dayName} {day.dayDateStr}
              </span>
              <span className="px-1.5 py-0.2 rounded-full bg-white/10 text-[10px] font-mono">
                {day.count}
              </span>
            </button>
          );
        })}

        {/* Button: ALL DAYS */}
        <button
          onClick={() => onSelectFilter('ALL')}
          className={`px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap shrink-0 transition-all flex items-center gap-1.5 cursor-pointer border ${
            selectedFilter === 'ALL'
              ? 'bg-[#E8B84A]/20 border-[#E8B84A] text-[#FFD97A] shadow-[0_0_12px_rgba(232,184,74,0.2)]'
              : 'bg-black/40 border-white/10 text-neutral-400 hover:text-white hover:bg-white/5'
          }`}
        >
          <Filter className="w-3 h-3 text-[#FFD97A]" />
          <span>ALL DAYS</span>
          <span className="px-1.5 py-0.2 rounded-full bg-white/10 text-[10px] font-mono">
            {totalCount}
          </span>
        </button>

        {/* Button: PAST ARCHIVE */}
        <button
          onClick={() => onSelectFilter('PAST')}
          className={`px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap shrink-0 transition-all flex items-center gap-1.5 cursor-pointer border ${
            selectedFilter === 'PAST'
              ? 'bg-neutral-800 border-neutral-600 text-neutral-200'
              : 'bg-black/30 border-white/5 text-neutral-500 hover:text-neutral-300 hover:bg-white/5'
          }`}
        >
          <History className="w-3 h-3 text-neutral-400" />
          <span>PAST ARCHIVE</span>
          <span className="px-1.5 py-0.2 rounded-full bg-white/10 text-[10px] font-mono">
            {pastCount}
          </span>
        </button>
      </div>
    </div>
  );
};
