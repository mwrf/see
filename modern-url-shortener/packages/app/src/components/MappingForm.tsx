// src/components/MappingForm.tsx
'use client';

import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { useAuth } from '@/contexts/AuthContext';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3001';

interface MappingFormProps {
  onMappingAddedOrUpdated: () => void; // Callback to refresh list
}

export default function MappingForm({ onMappingAddedOrUpdated }: MappingFormProps) {
  const { user, loading } = useAuth();
  const [shortPath, setShortPath] = useState('');
  const [longUrl, setLongUrl] = useState('');
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Clear form/message when auth state changes
  useEffect(() => {
    setShortPath('');
    setLongUrl('');
    setMessage(null);
  }, [user]);

  if (loading) {
    return <p className="text-center p-4">Loading form...</p>;
  }

  if (!user) {
    return (
      <div className="my-8 p-6 bg-white shadow rounded-lg text-center">
        <p className="text-gray-600">Please log in to manage URL mappings.</p>
      </div>
    );
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setMessage(null);
    setIsSubmitting(true);

    if (!shortPath.startsWith('/')) {
      setMessage({ type: 'error', text: 'Short path must start with /' });
      setIsSubmitting(false);
      return;
    }

    try {
      // This assumes the backend handles create vs update based on existence of shortPath
      // Or you might have separate POST (create) / PUT (update) endpoints
      await axios.post(`${API_BASE_URL}/api/mappings`,
        { [shortPath]: longUrl }, // Send as { "/path": "url" }
        { withCredentials: true }
      );
      setMessage({ type: 'success', text: `Mapping for '${shortPath}' successfully saved!` });
      setShortPath('');
      setLongUrl('');
      onMappingAddedOrUpdated(); // Trigger list refresh
    } catch (error: any) {
      console.error('Error saving mapping:', error);
      setMessage({
        type: 'error',
        text: error.response?.data?.message || 'Failed to save mapping. Ensure you are logged in and the path is valid.',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="my-8 p-6 bg-white shadow-lg rounded-lg">
      <h2 className="text-2xl font-semibold mb-6 text-gray-700">Add or Update URL Mapping</h2>
      <form onSubmit={handleSubmit} className="space-y-6">
        <div>
          <label htmlFor="shortPath" className="block text-sm font-medium text-gray-700 mb-1">
            Short Path (e.g., /example)
          </label>
          <input
            type="text"
            name="shortPath"
            id="shortPath"
            value={shortPath}
            onChange={(e) => setShortPath(e.target.value)}
            required
            className="mt-1 block w-full px-4 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
            placeholder="/my-link"
          />
        </div>
        <div>
          <label htmlFor="longUrl" className="block text-sm font-medium text-gray-700 mb-1">
            Destination URL (e.g., https://example.com)
          </label>
          <input
            type="url"
            name="longUrl"
            id="longUrl"
            value={longUrl}
            onChange={(e) => setLongUrl(e.target.value)}
            required
            className="mt-1 block w-full px-4 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
            placeholder="https://destination.com/very/long/url"
          />
        </div>
        <div>
          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:bg-gray-400"
          >
            {isSubmitting ? 'Saving...' : 'Save Mapping'}
          </button>
        </div>
      </form>
      {message && (
        <div className={`mt-4 p-3 rounded-md text-sm ${message.type === 'success' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
          {message.text}
        </div>
      )}
    </div>
  );
}
