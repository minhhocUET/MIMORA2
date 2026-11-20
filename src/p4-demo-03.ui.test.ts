import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { AuthContext, type AuthContextValue } from './auth/AuthContext.tsx';
import { LoginPage } from './components/auth/LoginPage.tsx';

function makeAuthContextValue(demoModeEnabled: boolean): AuthContextValue {
  return {
    status: 'unauthenticated',
    context: null,
    resolvedRole: null,
    authNotice: null,
    demoModeEnabled,
    locale: 'vi-VN',
    setLocale: () => {},
    refreshMe: async () => null,
    login: async () => {
      throw new Error('not called in SSR test');
    },
    loginDemoPersona: async () => {
      throw new Error('not called in SSR test');
    },
    switchOrganization: async () => {
      throw new Error('not called in SSR test');
    },
    changePassword: async () => {},
    logout: async () => {},
    clearAuthNotice: () => {},
  };
}

describe('P4-DEMO-03 LoginPage Demo Quick Access UI gating & labels', () => {
  it('hides the Demo Quick Access section completely when demoModeEnabled is false', () => {
    const html = renderToString(
      createElement(
        AuthContext.Provider,
        { value: makeAuthContextValue(false) },
        createElement(LoginPage)
      )
    );

    assert.equal(html.includes('Trải nghiệm MIMORA'), false);
    assert.equal(html.includes('Trải nghiệm Quản trị viên'), false);
    assert.equal(html.includes('Trải nghiệm Giáo viên'), false);
    assert.equal(html.includes('Trải nghiệm Phụ huynh'), false);
    assert.equal(html.includes('Trải nghiệm Học sinh – Trường học'), false);
    assert.equal(html.includes('Trải nghiệm Học sinh – Gia đình'), false);
    // Normal login still renders
    assert.equal(html.includes('Đăng nhập MIMORA'), true);
  });

  it('renders Trải nghiệm MIMORA and all 5 persona buttons without exposing credentials when demoModeEnabled is true', () => {
    const html = renderToString(
      createElement(
        AuthContext.Provider,
        { value: makeAuthContextValue(true) },
        createElement(LoginPage)
      )
    );

    assert.equal(html.includes('Trải nghiệm MIMORA'), true);
    assert.equal(html.includes('Chọn vai trò để khám phá các tính năng của MIMORA.'), true);
    assert.equal(html.includes('Trải nghiệm Quản trị viên'), true);
    assert.equal(html.includes('Trải nghiệm Giáo viên'), true);
    assert.equal(html.includes('Trải nghiệm Phụ huynh'), true);
    assert.equal(html.includes('Trải nghiệm Học sinh – Trường học'), true);
    assert.equal(html.includes('Trải nghiệm Học sinh – Gia đình'), true);

    // Must never display credentials or internal demo usernames/codes in UI
    assert.equal(html.includes('demo_admin'), false);
    assert.equal(html.includes('demo_teacher'), false);
    assert.equal(html.includes('demo.guardian@example.com'), false);
    assert.equal(html.includes('demo_student_dual'), false);
    assert.equal(html.includes('demo_student_family'), false);
    assert.equal(html.includes('FAM-DMO001'), false);

    // Normal login form also remains accessible
    assert.equal(html.includes('Đăng nhập MIMORA'), true);
  });
});
