export default function TopBar() {
  return (
    <header className="titlebar-drag flex h-12 items-center justify-between border-b border-topbar-border bg-topbar-bg px-4">
      <div className="titlebar-no-drag flex items-center gap-2">
        <span className="text-sm text-sidebar-muted">ShrinkFlow</span>
      </div>
      <div className="titlebar-no-drag flex items-center gap-2">
        {/* Placeholder for future actions */}
      </div>
    </header>
  )
}
