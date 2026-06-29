import { Link, NavLink } from 'react-router-dom';
import {
  Star, Layout, TrendingUp, PieChart, Radio, Filter,
  Briefcase, MessageCircle, Headphones, Settings,
} from 'lucide-react';

interface SidebarItem {
  icon: React.ElementType;
  label: string;
  path: string | null;
  placeholder: boolean; // placeholder = clickable but don't highlight as active
}

const items: SidebarItem[] = [
  { icon: Star, label: 'Watchlist', path: '/', placeholder: true },
  { icon: Layout, label: 'Layout', path: '/stock/BBRI.JK', placeholder: false },
  { icon: TrendingUp, label: 'Markets', path: '/', placeholder: false },
  { icon: PieChart, label: 'Portfolio', path: '/portfolio', placeholder: false },
  { icon: Radio, label: 'Stream', path: null, placeholder: true },
  { icon: Filter, label: 'Screener', path: null, placeholder: true },
  { icon: Briefcase, label: 'Broker', path: null, placeholder: true },
  { icon: MessageCircle, label: 'Chat', path: null, placeholder: true },
  { icon: Headphones, label: 'Support', path: null, placeholder: true },
  { icon: Settings, label: 'Settings', path: null, placeholder: true },
];

export default function Sidebar() {
  return (
    <aside className="sidebar">
      <div className="sidebar-logo">
        <TrendingUp size={24} color="var(--accent-primary)" />
      </div>
      <nav className="sidebar-nav">
        {items.map((item) => {
          const Icon = item.icon;

          // Disabled item (no path)
          if (item.path === null) {
            return (
              <div
                key={item.label}
                className="sidebar-item sidebar-item-disabled"
                title={item.label === 'Layout' ? 'Coming soon' : undefined}
              >
                <Icon size={20} />
                <span>{item.label}</span>
              </div>
            );
          }

          // Placeholder item (clickable, no active highlight)
          if (item.placeholder) {
            return (
              <Link key={item.label} to={item.path} className="sidebar-item sidebar-item-placeholder">
                <Icon size={20} />
                <span>{item.label}</span>
              </Link>
            );
          }

          // Real navigable item with active highlight
          return (
            <NavLink
              key={item.label}
              to={item.path}
              end
              className={({ isActive }) =>
                `sidebar-item ${isActive ? 'sidebar-item-active' : ''}`
              }
            >
              <Icon size={20} />
              <span>{item.label}</span>
            </NavLink>
          );
        })}
      </nav>
    </aside>
  );
}
