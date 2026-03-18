import React from 'react';
import { Link } from 'react-router-dom';

function Banner({ title, subtitle, breadcrumbs }) {
  // Parse breadcrumbs from title if in "Home > Page" format
  const parseBreadcrumbs = () => {
    if (breadcrumbs) return breadcrumbs;
    if (title && title.includes(' > ')) {
      const parts = title.split(' > ');
      return parts.map((part, index) => ({
        label: part.trim(),
        path: index === 0 ? '/' : null, // Only first item (Home) is linked
      }));
    }
    return null;
  };

  const crumbs = parseBreadcrumbs();
  const pageTitle = crumbs ? crumbs[crumbs.length - 1].label : title;

  return (
    <div className="mb-8">
      {/* Breadcrumbs */}
      {crumbs && crumbs.length > 1 && (
        <nav className="flex items-center text-sm text-gray-500 mb-2">
          {crumbs.map((crumb, index) => (
            <React.Fragment key={index}>
              {index > 0 && (
                <svg className="w-4 h-4 mx-2 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              )}
              {crumb.path ? (
                <Link to={crumb.path} className="hover:text-gray-700 transition-colors">
                  {crumb.label}
                </Link>
              ) : (
                <span className="text-gray-900 font-medium">{crumb.label}</span>
              )}
            </React.Fragment>
          ))}
        </nav>
      )}

      {/* Title */}
      <h1 className="text-2xl md:text-3xl text-gray-900 font-bold">{pageTitle}</h1>

      {/* Subtitle */}
      {subtitle && (
        <p className="text-gray-500 mt-1">{subtitle}</p>
      )}
    </div>
  );
}

export default Banner;
