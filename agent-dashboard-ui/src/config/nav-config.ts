import { NavGroup } from '@/types';

/**
 * Navigation configuration with RBAC support
 *
 * This configuration is used for both the sidebar navigation and Cmd+K bar.
 * Items are organized into groups, each rendered with a SidebarGroupLabel.
 *
 * RBAC Access Control:
 * Each navigation item can have an `access` property that controls visibility
 * based on permissions, plans, features, roles, and organization context.
 *
 * Examples:
 *
 * 1. Require organization:
 *    access: { requireOrg: true }
 *
 * 2. Require specific permission:
 *    access: { requireOrg: true, permission: 'org:teams:manage' }
 *
 * 3. Require specific plan:
 *    access: { plan: 'pro' }
 *
 * 4. Require specific feature:
 *    access: { feature: 'premium_access' }
 *
 * 5. Require specific role:
 *    access: { role: 'admin' }
 *
 * 6. Multiple conditions (all must be true):
 *    access: { requireOrg: true, permission: 'org:teams:manage', plan: 'pro' }
 *
 * Note: The `visible` function is deprecated but still supported for backward compatibility.
 * Use the `access` property for new items.
 */
export const navGroups: NavGroup[] = [
  {
    label: 'Sistema',
    items: [
      {
        title: 'Canales',
        url: '/dashboard/canales',
        icon: 'dashboard',
        isActive: false,
        items: []
      },
      {
        title: '# general',
        url: '/dashboard/general',
        icon: 'page',
        isActive: false,
        items: []
      },
      {
        title: '# rendimiento',
        url: '/dashboard/rendimiento',
        icon: 'trendingUp',
        isActive: false,
        items: []
      },
      {
        title: 'Leads Precualificados',
        url: '/dashboard/leads',
        icon: 'teams',
        isActive: true,
        items: []
      },
      {
        title: '# calendario',
        url: '/dashboard/calendario',
        icon: 'calendar',
        isActive: false,
        items: []
      }
    ]
  },
  {
    label: 'Agentes Disponibles',
    items: [
      {
        title: 'Ventas - Ana',
        url: '/dashboard/agentes/ventas',
        icon: 'profile',
        isActive: false,
        items: []
      },
      {
        title: 'Soporte - Carlos',
        url: '/dashboard/agentes/soporte',
        icon: 'profile',
        isActive: false,
        items: []
      }
    ]
  },
  {
    label: 'Historial de Chat',
    items: [
      {
        title: 'Chat Cliente A',
        url: '/dashboard/chat/1',
        icon: 'chat',
        isActive: false,
        items: []
      }
    ]
  }
];
