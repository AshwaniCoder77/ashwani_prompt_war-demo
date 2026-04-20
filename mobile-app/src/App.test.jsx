import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import App from './App';

describe('App Component', () => {
  it('renders the login header when not authenticated', () => {
    // Ensure localStorage is empty for the test
    localStorage.clear();
    
    render(<App />);
    
    expect(screen.getByText('FlowVenue Security Phase')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /log in/i })).toBeInTheDocument();
  });

  it('renders semantic main landmark', () => {
    render(<App />);
    expect(screen.getByRole('main')).toBeInTheDocument();
  });

  it('contains the Google Login button', () => {
    render(<App />);
    expect(screen.getByText('Google Login')).toBeInTheDocument();
  });
});
