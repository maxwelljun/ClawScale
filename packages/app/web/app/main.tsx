import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import './globals.css';

import DashboardLayout from './layouts/DashboardLayout';
import Dashboard from './pages/Dashboard';
import Conversations from './pages/Conversations';
import Channels from './pages/Channels';
import AiBackends from './pages/AiBackends';
import Users from './pages/Users';
import EndUsers from './pages/EndUsers';
import Settings from './pages/Settings';
import Onboarding from './pages/Onboarding';
import Login from './pages/Login';
import Register from './pages/Register';
import Onboard from './pages/Onboard';
import { getTenant } from '@/lib/auth';
import type { TenantSettings } from '@clawscale/shared';

function HomeRedirect() {
  const tenant = getTenant();
  const defaultHomePage = (tenant?.settings as TenantSettings | undefined)?.defaultHomePage ?? '/dashboard';
  return <Navigate to={defaultHomePage} replace />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/onboard" element={<Onboard />} />
        <Route element={<DashboardLayout />}>
          <Route index element={<HomeRedirect />} />
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="conversations" element={<Conversations />} />
          <Route path="channels" element={<Channels />} />
          <Route path="ai-backends" element={<AiBackends />} />
          <Route path="end-users" element={<EndUsers />} />
          <Route path="users" element={<Users />} />
          <Route path="onboarding" element={<Onboarding />} />
          <Route path="settings" element={<Settings />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
