/**
 * Navigation model - Artupski ReSite
 *
 * Phase 1 exposes only the routes that actually exist (task section 5 & 8).
 * Future features (Blueprint, Projects engine, etc.) are intentionally absent;
 * the shelf for them is the services/ modules, not placeholder nav items.
 */
import type { ComponentType, SVGProps } from 'react';
import { IconHome, IconProjects, IconScan, IconSettings } from '../components/ui/icons';

export interface NavItem {
  to: string;
  label: string;
  description: string;
  icon: ComponentType<SVGProps<SVGSVGElement> & { size?: number }>;
  /** `end` makes the root route match exactly. */
  end?: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  {
    to: '/',
    label: 'Home',
    description: 'Enter a target URL and review recent projects',
    icon: IconHome,
    end: true,
  },
  {
    to: '/projects',
    label: 'Projects',
    description: 'Reverse-engineering projects stored on this machine',
    icon: IconProjects,
  },
  {
    to: '/scan',
    label: 'Scan',
    description: 'Configure and run a website scan (coming in a later phase)',
    icon: IconScan,
  },
  {
    to: '/settings',
    label: 'Settings',
    description: 'Application preferences and theme',
    icon: IconSettings,
  },
];
