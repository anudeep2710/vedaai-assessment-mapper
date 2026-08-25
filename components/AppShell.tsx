"use client";

import type { ReactNode } from "react";
import {
  Bell,
  BookOpen,
  ChevronDown,
  CircleHelp,
  ClipboardList,
  Clock3,
  FileText,
  GraduationCap,
  LayoutDashboard,
  Settings,
  Sparkles,
} from "lucide-react";

type AppShellProps = {
  children: ReactNode;
  compactNav?: boolean;
  onBack?: () => void;
};

const navigation = [
  { label: "Home", icon: LayoutDashboard },
  { label: "My Classroom", icon: GraduationCap },
  { label: "Assignments", icon: ClipboardList },
  { label: "Exams", icon: FileText, active: true },
  { label: "My Library", icon: BookOpen },
];

export function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <span className={`brand-mark${compact ? " is-compact" : ""}`} aria-hidden="true">
      V
    </span>
  );
}

function Avatar({ small = false }: { small?: boolean }) {
  return (
    <span className={`avatar${small ? " is-small" : ""}`} aria-hidden="true">
      MR
    </span>
  );
}

function Sidebar({ compact }: { compact: boolean }) {
  return (
    <aside className={`sidebar${compact ? " is-compact" : ""}`}>
      <div className="sidebar-brand">
        <BrandMark compact={compact} />
        {!compact && <span className="brand-name">VedaAI</span>}
        {compact && <span className="sidebar-collapse-mark">⌁</span>}
      </div>

      {!compact && (
        <button className="toolkit-button" type="button">
          <Sparkles size={13} strokeWidth={2.3} />
          AI Teacher&apos;s Toolkit
        </button>
      )}

      <nav className="sidebar-nav" aria-label="Main navigation">
        {navigation.map(({ label, icon: Icon, active }) => (
          <button className={`nav-item${active ? " is-active" : ""}`} type="button" key={label} title={compact ? label : undefined}>
            <Icon size={compact ? 16 : 13} strokeWidth={1.8} />
            {!compact && <span>{label}</span>}
          </button>
        ))}
      </nav>

      <div className="sidebar-bottom">
        <button className="nav-item settings-item" type="button" title={compact ? "Settings" : undefined}>
          <Settings size={compact ? 16 : 13} strokeWidth={1.8} />
          {!compact && <span>Settings</span>}
        </button>
        {!compact && (
          <div className="school-card">
            <div className="school-seal">✺</div>
            <div>
              <strong>Delhi Public School</strong>
              <span>Bakhtawar Sirohi City</span>
            </div>
          </div>
        )}
        {compact && <div className="school-seal compact-seal">✺</div>}
      </div>
    </aside>
  );
}

function Topbar({ onBack }: { onBack?: () => void }) {
  return (
    <header className="topbar">
      <div className="topbar-leading">
        <button className="topbar-back" type="button" onClick={onBack} aria-label="Go back">
          <span>‹</span>
        </button>
        <span className="topbar-folder" aria-hidden="true">□</span>
        <span className="topbar-location">Exams</span>
      </div>

      <div className="mobile-brand">
        <BrandMark />
        <span>VedaAI</span>
      </div>

      <div className="topbar-actions">
        <button className="icon-button" type="button" aria-label="Help">
          <CircleHelp size={14} />
        </button>
        <button className="icon-button notification-button" type="button" aria-label="Notifications">
          <Bell size={14} />
          <span className="notification-dot" />
        </button>
        <button className="icon-button sparkle-button" type="button" aria-label="AI tools">
          <Sparkles size={14} />
        </button>
        <button className="profile-button" type="button">
          <Avatar small />
          <span>Madhur Rastogi</span>
          <ChevronDown size={12} />
        </button>
        <button className="mobile-menu-button" type="button" aria-label="Open menu">
          <span />
          <span />
          <span />
        </button>
      </div>
    </header>
  );
}

export function AppShell({ children, compactNav = false, onBack }: AppShellProps) {
  return (
    <div className={`app-shell${compactNav ? " has-compact-nav" : ""}`}>
      <Sidebar compact={compactNav} />
      <div className="workspace">
        <Topbar onBack={onBack} />
        <main className="workspace-main">{children}</main>
      </div>
    </div>
  );
}

export function TeacherBadge() {
  return (
    <div className="teacher-badge" aria-hidden="true">
      <span className="teacher-orbit orbit-one" />
      <span className="teacher-orbit orbit-two" />
      <span className="teacher-orbit orbit-three" />
      <div className="teacher-badge-ring">
        <span>👩🏽‍🏫</span>
      </div>
    </div>
  );
}

export function MappingIcon({ size = 18 }: { size?: number }) {
  return <Clock3 size={size} strokeWidth={1.8} />;
}
