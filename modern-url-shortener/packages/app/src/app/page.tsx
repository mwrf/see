// src/app/page.tsx
'use client'; // Make page client component to manage state for refresh

import { useState, useCallback } from 'react';
import MappingList from '@/components/MappingList';
import MappingForm from '@/components/MappingForm';

export default function HomePage() {
  // This key is used to force re-render of MappingList when a new mapping is added/updated
  const [mappingListKey, setMappingListKey] = useState(Date.now());

  const handleMappingAddedOrUpdated = useCallback(() => {
    setMappingListKey(Date.now()); // Update key to trigger re-fetch in MappingList
  }, []);

  return (
    <div>
      <div className="my-8 p-6 bg-white shadow rounded-lg">
        <h1 className="text-3xl font-bold text-center text-gray-800 mb-4">
          Welcome to the Modern URL Shortener
        </h1>
        <p className="text-center text-gray-600">
          View existing short URLs below. Authenticated users can manage mappings.
        </p>
      </div>
      <MappingForm onMappingAddedOrUpdated={handleMappingAddedOrUpdated} />
      <MappingList key={mappingListKey} /> {/* Add key here */}
    </div>
  );
}
