// src/components/Header.tsx
'use client';

import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext'; // Import useAuth

export default function Header() {
  const { user, loading, login, logout } = useAuth();

  return (
    <header className="bg-gray-800 text-white p-4 shadow-md">
      <nav className="container mx-auto flex justify-between items-center">
        <Link href="/" className="text-xl font-bold hover:text-gray-300">
          URL Shortener
        </Link>
        <div className="flex items-center space-x-4">
          {loading ? (
            <p>Loading...</p>
          ) : user ? (
            <>
              <span className="text-sm">
                Welcome, {user.displayName || user.emails?.[0]?.value || 'User'}
              </span>
              <button
                onClick={logout}
                className="bg-red-500 hover:bg-red-700 text-white font-bold py-2 px-4 rounded transition duration-150"
              >
                Logout
              </button>
            </>
          ) : (
            <button
              onClick={login}
              className="bg-green-500 hover:bg-green-700 text-white font-bold py-2 px-4 rounded transition duration-150"
            >
              Login with Google
            </button>
          )}
        </div>
      </nav>
    </header>
  );
}
