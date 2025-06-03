// src/components/MappingList.tsx
'use client'; // This component will fetch data client-side

import { useEffect, useState } from 'react';
import axios from 'axios';

interface Mapping {
  [key: string]: string;
}

export default function MappingList() {
  const [mappings, setMappings] = useState<Mapping | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    const fetchMappings = async () => {
      try {
        // IMPORTANT: Adjust NEXT_PUBLIC_API_BASE_URL later for different environments
        const response = await axios.get(`${process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3001'}/api/mappings`);
        setMappings(response.data);
      } catch (err) {
        console.error("Error fetching mappings:", err);
        setError("Failed to load mappings. Ensure the backend server is running.");
      } finally {
        setLoading(false);
      }
    };
    fetchMappings();
  }, []);

  if (loading) return <p className="text-center text-gray-500">Loading mappings...</p>;
  if (error) return <p className="text-center text-red-500 bg-red-100 p-4 rounded-md">{error}</p>;
  if (!mappings || Object.keys(mappings).length === 0) return <p className="text-center text-gray-700">No mappings found.</p>;

  return (
    <div className="bg-white shadow-lg rounded-lg p-6">
      <h2 className="text-2xl font-semibold mb-6 text-gray-700">Current URL Mappings</h2>
      <div className="overflow-x-auto">
        <table className="min-w-full table-auto border-collapse border border-gray-300">
          <thead className="bg-gray-100">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider border-b border-gray-300">Short Path</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider border-b border-gray-300">Destination URL</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {Object.entries(mappings).map(([shortPath, longUrl]) => (
              <tr key={shortPath} className="hover:bg-gray-50">
                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-blue-600 hover:text-blue-800">
                  <a href={shortPath} target="_blank" rel="noopener noreferrer">{shortPath}</a>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700 truncate max-w-md" title={longUrl}>{longUrl}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
