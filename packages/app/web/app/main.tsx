import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import './globals.css';

import DashboardLayout from './layouts/DashboardLayout';
import Dashboard from './pages/Dashboard';
import Conversations from './pages/Conversations';
import Channels from './pages/Channels';
import Agents from './pages/Agents';
import Models from './pages/Models';
import Users from './pages/Users';
import EndUsers from './pages/EndUsers';
import Settings from './pages/Settings';
import Onboarding from './pages/Onboarding';
import Login from './pages/Login';
import Register from './pages/Register';
import Onboard from './pages/Onboard';
import { getTenant } from '@/lib/auth';
import { api } from '@/lib/api';
import type { TenantSettings, ApiResponse } from '@clawscale/shared';

function HomeRedirect() {
  // If we have tenant data in localStorage, use it directly
  const tenant = getTenant();
  const localDefault = (tenant?.settings as TenantSettings | undefined)?.defaultHomePage;
  if (localDefault) return <Navigate to={localDefault} replace />;
  if (tenant) return <Navigate to="/dashboard" replace />;

  // No tenant in localStorage (unauthenticated) — fetch from public endpoint
  const [target, setTarget] = useState<string | null>(null);
  useEffect(() => {
    api.get<ApiResponse<{ defaultHomePage: string | null }>>('/auth/status').then((res) => {
      setTarget(res.ok && res.data.defaultHomePage ? res.data.defaultHomePage : '/dashboard');
    }).catch(() => setTarget('/dashboard'));
  }, []);
  if (!target) return null;
  return <Navigate to={target} replace />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/onboard" element={<Onboard />} />
        <Route index element={<HomeRedirect />} />
        <Route element={<DashboardLayout />}>
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="conversations" element={<Conversations />} />
          <Route path="channels" element={<Channels />} />
          <Route path="agents" element={<Agents />} />
          <Route path="ai-backends" element={<Navigate to="/agents" replace />} />
          <Route path="models" element={<Models />} />
          <Route path="end-users" element={<EndUsers />} />
          <Route path="users" element={<Users />} />
          <Route path="onboarding" element={<Onboarding />} />
          <Route path="settings" element={<Settings />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
