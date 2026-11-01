import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { useState } from 'react';
import * as S from './store/store';
import { Button, Card, Field, Input, UIProvider, useRun, NoAccess } from './ui/kit';
import { Layout } from './ui/shell';
import { ROLES, type Module } from './domain/types';
import Dashboard from './pages/Dashboard';
import Leads from './pages/Leads';
import { StudentList, StudentProfile } from './pages/Students';
import Admissions from './pages/Admissions';
import Fees from './pages/Fees';
import Collections from './pages/Collections';
import Batches from './pages/Batches';
import Certificates from './pages/Certificates';
import Expenses from './pages/Expenses';
import Profit from './pages/Profit';
import Reports from './pages/Reports';
import Employees from './pages/Employees';
import Notifications from './pages/Notifications';
import Settings from './pages/Settings';
import Receipt from './pages/Receipt';
import Invoices from './pages/Invoices';
import Kits from './pages/Kits';
import CloudAuth from './pages/CloudAuth';
import StudentPortal from './pages/StudentPortal';

const guard = (mod: Module, el: JSX.Element) => (S.allowed(mod) ? el : <NoAccess />);

export default function App() {
  const me = S.useMe();
  const cloud = S.useCloud();
  S.useDB();
  return (
    <UIProvider>
      <BrowserRouter>
        {cloud.phase === 'student' ? <StudentPortal /> : cloud.enabled && (!me || cloud.phase !== 'ready') ? <CloudAuth /> : !me ? <SignIn /> : (
          <Routes>
            <Route path="/receipt/:id" element={guard('fees', <Receipt />)} />
            <Route path="*" element={
              <Layout>
                <Routes>
                  <Route path="/" element={S.allowed('dashboard') ? <Dashboard /> : <Navigate to={S.allowed('leads') ? '/leads' : S.allowed('batches') ? '/batches' : '/notifications'} replace />} />
                  <Route path="/leads" element={guard('leads', <Leads />)} />
                  <Route path="/students" element={guard('students', <StudentList />)} />
                  <Route path="/students/:id" element={guard('students', <StudentProfile />)} />
                  <Route path="/kits" element={guard('students', <Kits />)} />
                  <Route path="/admissions" element={guard('admissions', <Admissions />)} />
                  <Route path="/fees" element={guard('fees', <Fees />)} />
                  <Route path="/collections" element={guard('collections', <Collections />)} />
                  <Route path="/invoices" element={guard('fees', <Invoices />)} />
                  <Route path="/batches" element={guard('batches', <Batches />)} />
                  <Route path="/certificates" element={guard('certificates', <Certificates />)} />
                  <Route path="/expenses" element={guard('expenses', <Expenses />)} />
                  <Route path="/profit" element={guard('profit', <Profit />)} />
                  <Route path="/reports" element={guard('reports', <Reports />)} />
                  <Route path="/employees" element={guard('employees', <Employees />)} />
                  <Route path="/notifications" element={<Notifications />} />
                  <Route path="/settings" element={guard('settings', <Settings />)} />
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
              </Layout>
            } />
          </Routes>
        )}
      </BrowserRouter>
    </UIProvider>
  );
}

function SignIn() {
  const db = S.useDB();
  const run = useRun();
  const [f, setF] = useState({ name: '', phone: '', email: '' });
  const first = db.employees.length === 0;
  return (
    <div className="min-h-full grid place-items-center bg-white p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <img src="/logo-full.png" alt="InvestMore" className="mx-auto w-56 mix-blend-multiply" />
          <div className="text-xs text-muted mt-2">Academy management</div>
        </div>
        <Card className="p-5">
          {first ? (
            <>
              <h1 className="font-semibold text-[15px]">Set up your academy</h1>
              <p className="text-muted mt-1 mb-4">Create the first Super Admin account. You can add staff after signing in.</p>
              <div className="space-y-3">
                <Field label="Your name" required><Input autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
                <Field label="Mobile" required><Input inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
                <Field label="Email"><Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
                <Button variant="primary" className="w-full" disabled={!f.name || !f.phone} onClick={() => run(() => S.createFirstAdmin(f.name, f.phone, f.email))}>Create account</Button>
              </div>
            </>
          ) : (
            <>
              <h1 className="font-semibold text-[15px]">Sign in</h1>
              <p className="text-muted mt-1 mb-4">Choose your account.</p>
              <div className="space-y-1.5">
                {db.employees.filter((e) => e.active).map((e) => (
                  <button key={e.id} onClick={() => run(() => S.login(e.id))} className="w-full flex items-center gap-3 rounded-lg border border-line px-3 py-2.5 hover:bg-surface text-left">
                    <div className="size-8 rounded-full bg-accent-soft text-accent grid place-items-center font-semibold">{e.name[0]}</div>
                    <div className="flex-1"><div className="font-medium">{e.name}</div><div className="text-xs text-muted">{ROLES.find((r) => r.id === e.role)?.label}</div></div>
                  </button>
                ))}
              </div>
              <p className="text-[11.5px] text-muted mt-4">Local MVP sign-in. Password / OTP login arrives with Supabase Auth.</p>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
