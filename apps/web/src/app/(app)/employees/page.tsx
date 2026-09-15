import type { Metadata } from 'next';
import {
  Badge,
  Card,
  EmptyState,
  NoAccess,
  PageHeader,
  Table,
  Td,
  Th,
  toneForStatus,
} from '@/components/ui';
import { apiFetchOrNull } from '@/lib/api';
import { date, label, money } from '@/lib/format';
import type { Employee, Page } from '@/lib/types';

export const metadata: Metadata = { title: 'Employees' };

/**
 * The compensation column is present only when the API actually returned it.
 *
 * The server strips those fields for a caller without `employee:read_sensitive`,
 * so this check reflects a decision already made server-side rather than
 * enforcing one here. Hiding a column in the browser is presentation; the data
 * never arrived in the first place.
 */
export default async function EmployeesPage() {
  const page = await apiFetchOrNull<Page<Employee>>('/api/v1/employees?limit=50');
  if (!page) return <NoAccess permission="employee:read" />;

  const showsCompensation = page.items.some((employee) => employee.compensation !== null);

  return (
    <>
      <PageHeader
        title="Employees"
        description={
          showsCompensation
            ? 'Including compensation, which your role is cleared to see.'
            : 'Compensation is hidden — it needs the employee:read_sensitive permission.'
        }
      />

      <Card>
        {page.items.length === 0 ? (
          <EmptyState title="No employee records" />
        ) : (
          <Table minWidth="44rem">
            <thead>
              <tr>
                <Th>Name</Th>
                <Th>Role</Th>
                <Th>Department</Th>
                <Th>Status</Th>
                {showsCompensation ? <Th align="right">Compensation</Th> : null}
                <Th align="right">Hired</Th>
              </tr>
            </thead>
            <tbody>
              {page.items.map((employee) => (
                <tr key={employee.id}>
                  <Td>
                    <span className="font-medium text-ink">{employee.fullName}</span>
                  </Td>
                  <Td>
                    <span className="text-ink-muted">{employee.jobTitle ?? '—'}</span>
                  </Td>
                  <Td>
                    <span className="text-ink-muted">{employee.department ?? '—'}</span>
                  </Td>
                  <Td>
                    <Badge tone={toneForStatus(employee.status)}>{label(employee.status)}</Badge>
                  </Td>
                  {showsCompensation ? (
                    <Td align="right" numeric>
                      {money(employee.compensation)}
                      {employee.payPeriod ? (
                        <span className="ml-1 text-xs text-ink-faint">/{employee.payPeriod}</span>
                      ) : null}
                    </Td>
                  ) : null}
                  <Td align="right">
                    <span className="text-ink-muted">{date(employee.hiredAt)}</span>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
