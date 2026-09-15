import { describe, expect, it } from 'vitest';
import {
  PERMISSIONS,
  ROLES,
  type Role,
  can,
  canAll,
  canAny,
  canAssignRole,
  isPermission,
  isRole,
  permissionsFor,
  rankOf,
} from './rbac.js';

describe('rbac', () => {
  it('denies unknown roles and unknown permissions', () => {
    expect(can('superuser', 'client:read')).toBe(false);
    expect(can('owner', 'client:teleport')).toBe(false);
    expect(can('', '')).toBe(false);
    expect(isRole('owner')).toBe(true);
    expect(isRole('root')).toBe(false);
    expect(isPermission('client:read')).toBe(true);
    expect(isPermission('client:destroy')).toBe(false);
  });

  it('gives owner every permission', () => {
    for (const permission of PERMISSIONS) {
      expect(can('owner', permission)).toBe(true);
    }
  });

  it('keeps viewer strictly read-only', () => {
    const writeish = PERMISSIONS.filter(
      (p) => !p.endsWith(':read') && !p.endsWith(':read_sensitive'),
    );
    for (const permission of writeish) {
      expect(can('viewer', permission)).toBe(false);
    }
  });

  it('protects salary data behind employee:read_sensitive', () => {
    expect(can('owner', 'employee:read_sensitive')).toBe(true);
    expect(can('admin', 'employee:read_sensitive')).toBe(true);
    expect(can('finance', 'employee:read_sensitive')).toBe(true);
    expect(can('manager', 'employee:read_sensitive')).toBe(false);
    expect(can('member', 'employee:read_sensitive')).toBe(false);
    expect(can('viewer', 'employee:read_sensitive')).toBe(false);
  });

  it('keeps issuing and voiding invoices with finance and above', () => {
    expect(can('finance', 'invoice:issue')).toBe(true);
    expect(can('admin', 'invoice:void')).toBe(true);
    expect(can('manager', 'invoice:issue')).toBe(false);
    expect(can('member', 'payment:record')).toBe(false);
  });

  it('lets managers run delivery but not money', () => {
    expect(canAll('manager', ['project:create', 'task:delete', 'time_entry:approve'])).toBe(true);
    expect(canAny('manager', ['invoice:issue', 'payment:record'])).toBe(false);
  });

  it('only exposes permissions that exist in the catalogue', () => {
    for (const role of ROLES) {
      for (const permission of permissionsFor(role)) {
        expect(isPermission(permission)).toBe(true);
      }
    }
  });

  it('orders roles by seniority', () => {
    const ordered: Role[] = ['viewer', 'member', 'manager', 'finance', 'admin', 'owner'];
    const ranks = ordered.map(rankOf);
    expect([...ranks].sort((a, b) => a - b)).toEqual(ranks);
  });

  describe('canAssignRole', () => {
    it('only lets an owner create another owner', () => {
      expect(canAssignRole('owner', 'owner')).toBe(true);
      expect(canAssignRole('admin', 'owner')).toBe(false);
    });

    it('stops sideways and upward grants', () => {
      expect(canAssignRole('admin', 'admin')).toBe(false);
      expect(canAssignRole('admin', 'manager')).toBe(true);
      expect(canAssignRole('manager', 'member')).toBe(false); // manager lacks member:update_role
    });

    it('denies roles without the role-management permission outright', () => {
      for (const role of ['finance', 'manager', 'member', 'viewer'] as const) {
        expect(canAssignRole(role, 'viewer')).toBe(false);
      }
    });
  });
});
