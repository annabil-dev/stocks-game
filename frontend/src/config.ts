// Centralized config — all backend URLs come from here
const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3002';
export const API_BASE = `${BACKEND_URL}/api`;
export default BACKEND_URL;