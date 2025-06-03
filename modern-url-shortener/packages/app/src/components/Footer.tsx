// src/components/Footer.tsx
export default function Footer() {
  return (
    <footer className="bg-gray-100 text-center p-4 mt-8 border-t">
      <p>&copy; {new Date().getFullYear()} Modern URL Shortener. All rights reserved.</p>
    </footer>
  );
}
