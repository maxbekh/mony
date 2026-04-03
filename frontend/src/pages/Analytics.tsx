import React from 'react';
import Dashboard from './Dashboard';

const Analytics: React.FC = () => {
  // For the POC, Analytics and Dashboard share the same overview
  return <Dashboard />;
};

export default Analytics;
