import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import App from './App';

describe('App', () => {
  it('renders the toolbar actions', () => {
    render(<App />);
    expect(screen.getByRole('button', { name: /文件/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /发布/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /设置/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /帮助/ })).toBeInTheDocument();
  });
});
