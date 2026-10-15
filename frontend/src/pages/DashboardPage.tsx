import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { ArrowRight, ArrowRightLeft, BookUser, Plus } from 'lucide-react';
import { api } from '../lib/api';
import { formatAmount, formatDate, formatPlain } from '../lib/format';
import { useSettings } from '../lib/queries';
import type { Transaction } from '../lib/types';
import { Alert, BalanceBadge, ButtonLink, Card, EmptyState, ErrorState, PageHeader, StatCard, Skeleton } from '../components/ui';

function DashboardSkeleton() {
  return (
    <div className="space-y-6" role="status" aria-label="Loading dashboard">
      <Skeleton className="h-8 w-48" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-28" />
        ))}
      </div>
      <div className="grid gap-6 xl:grid-cols-3">
        <Skeleton className="h-72 xl:col-span-2" />
        <Skeleton className="h-72" />
      </div>
    </div>
  );
}

function TransactionRow({ t, symbol }: { t: Transaction; symbol: string }) {
  const increase = t.direction === 'INCREASE';
  return (
    <li className="flex items-center justify-between gap-3 py-3">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-slate-900">
          <Link to={`/accounts/${t.account.id}`} className="hover:text-indigo-700 hover:underline">
            {t.account.name}
          </Link>
        </p>
        <p className="truncate text-xs text-slate-500">
          {t.typeLabel} · {formatDate(t.entryDate)}
          {t.referenceNumber ? ` · ${t.referenceNumber}` : ''}
          {t.isReversed ? ' · reversed' : ''}
          {t.isReversal ? ' · reversal' : ''}
        </p>
      </div>
      <p className={`shrink-0 text-sm font-semibold tabular-nums ${increase ? 'text-amber-700' : 'text-emerald-700'}`}>
        {increase ? '+' : '−'} {formatAmount(t.amount, symbol)}
      </p>
    </li>
  );
}

export default function DashboardPage() {
  const dashboard = useQuery({ queryKey: ['dashboard'], queryFn: api.dashboard });
  const settings = useSettings();
  const symbol = settings.data?.business.currencySymbol ?? '₹';

  if (dashboard.isPending) return <DashboardSkeleton />;
  if (dashboard.isError) return <ErrorState message={dashboard.error.message} onRetry={() => void dashboard.refetch()} />;

  const d = dashboard.data;
  const accountCount = d.counts.activeCustomers + d.counts.inactiveCustomers + d.counts.activeSuppliers + d.counts.inactiveSuppliers;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        description={`Figures as of ${formatDate(d.today)} (${d.timezone}).`}
        actions={
          <>
            <ButtonLink to="/accounts/new">
              <Plus className="h-4 w-4" aria-hidden="true" /> New account
            </ButtonLink>
            <ButtonLink to="/transactions/new" variant="primary">
              <ArrowRightLeft className="h-4 w-4" aria-hidden="true" /> Add transaction
            </ButtonLink>
          </>
        }
      />

      {accountCount === 0 && d.counts.ledgerEntries === 0 && (
        <EmptyState
          title="Welcome! Let’s set up your first account."
          description="Start by adding a customer who owes you money, or a supplier you owe. Opening balances can be entered when you create the account."
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <ButtonLink to="/accounts/new" variant="primary">
                <Plus className="h-4 w-4" aria-hidden="true" /> Add a customer or supplier
              </ButtonLink>
            </div>
          }
        />
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Receivables (customers owe you)"
          value={formatAmount(d.receivables.total, symbol)}
          tone="warning"
          hint={`${d.counts.customersWithBalance} customer${d.counts.customersWithBalance === 1 ? '' : 's'} with a balance · credits ${formatAmount(d.receivables.credits, symbol)}`}
        />
        <StatCard
          label="Payables (you owe suppliers)"
          value={formatAmount(d.payables.total, symbol)}
          tone="info"
          hint={`${d.counts.suppliersWithBalance} supplier${d.counts.suppliersWithBalance === 1 ? '' : 's'} with a balance · credits ${formatAmount(d.payables.credits, symbol)}`}
        />
        <StatCard
          label={`Received today (${formatDate(d.todayPayments.date)})`}
          value={formatAmount(d.todayPayments.received, symbol)}
          tone="positive"
          hint={`${d.todayPayments.receivedCount} payment${d.todayPayments.receivedCount === 1 ? '' : 's'}`}
        />
        <StatCard
          label={`Paid today (${formatDate(d.todayPayments.date)})`}
          value={formatAmount(d.todayPayments.paid, symbol)}
          hint={`${d.todayPayments.paidCount} payment${d.todayPayments.paidCount === 1 ? '' : 's'}`}
        />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: 'Active customers', value: d.counts.activeCustomers, to: '/accounts?type=CUSTOMER&status=active' },
          { label: 'Active suppliers', value: d.counts.activeSuppliers, to: '/accounts?type=SUPPLIER&status=active' },
          { label: 'Ledger entries', value: d.counts.ledgerEntries, to: '/transactions' },
          { label: 'Entries today', value: d.counts.entriesToday, to: '/transactions' },
        ].map((item) => (
          <Link key={item.label} to={item.to} className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm hover:border-indigo-200">
            <p className="text-xs text-slate-500">{item.label}</p>
            <p className="mt-1 text-lg font-semibold tabular-nums text-slate-900">{item.value.toLocaleString('en-IN')}</p>
          </Link>
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2" padded={false}>
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 sm:px-6">
            <h2 className="text-base font-semibold text-slate-900">Recent transactions</h2>
            <Link to="/transactions" className="inline-flex items-center gap-1 text-sm font-medium text-indigo-700 hover:underline">
              View all <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </div>
          {d.recentTransactions.length === 0 ? (
            <div className="p-4 sm:p-6">
              <Alert tone="info">No transactions yet. Record a credit sale, purchase or payment to see it here.</Alert>
            </div>
          ) : (
            <ul className="divide-y divide-slate-100 px-4 sm:px-6">
              {d.recentTransactions.map((t) => (
                <TransactionRow key={t.id} t={t} symbol={symbol} />
              ))}
            </ul>
          )}
        </Card>

        <Card padded={false}>
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 sm:px-6">
            <h2 className="text-base font-semibold text-slate-900">Outstanding balances</h2>
            <span className="text-xs text-slate-500">{d.outstandingCount} account{d.outstandingCount === 1 ? '' : 's'}</span>
          </div>
          {d.outstandingAccounts.length === 0 ? (
            <div className="p-4 sm:p-6">
              <Alert tone="success">No outstanding balances. Everything is settled.</Alert>
            </div>
          ) : (
            <ul className="divide-y divide-slate-100 px-4 sm:px-6">
              {d.outstandingAccounts.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <Link to={`/accounts/${a.id}`} className="block truncate text-sm font-medium text-slate-900 hover:text-indigo-700 hover:underline">
                      {a.name}
                    </Link>
                    <p className="text-xs text-slate-500">
                      <span className="font-mono">{a.accountCode}</span> · <BalanceBadge status={a.balance.status} accountType={a.type} />
                    </p>
                  </div>
                  <p className="shrink-0 text-right text-sm font-semibold tabular-nums text-slate-900">{formatPlain(a.balance.amount)}</p>
                </li>
              ))}
            </ul>
          )}
          {d.outstandingCount > d.outstandingAccounts.length && (
            <div className="border-t border-slate-200 px-4 py-3 text-sm sm:px-6">
              <Link to="/accounts" className="font-medium text-indigo-700 hover:underline">
                See all {d.outstandingCount} accounts
              </Link>
            </div>
          )}
        </Card>
      </div>

      <Card>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Quick actions</h2>
            <p className="text-sm text-slate-600">Record a sale, a payment, a purchase or a supplier payment.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <ButtonLink to="/transactions/new?type=CREDIT_SALE">Credit sale</ButtonLink>
            <ButtonLink to="/transactions/new?type=PAYMENT_RECEIVED">Payment received</ButtonLink>
            <ButtonLink to="/transactions/new?type=CREDIT_PURCHASE">Credit purchase</ButtonLink>
            <ButtonLink to="/transactions/new?type=PAYMENT_MADE">Payment made</ButtonLink>
            <ButtonLink to="/accounts">
              <BookUser className="h-4 w-4" aria-hidden="true" /> Accounts
            </ButtonLink>
          </div>
        </div>
      </Card>
    </div>
  );
}
