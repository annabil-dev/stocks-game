import React, { createContext, useContext, useEffect, useState } from 'react';
import { API_BASE } from './config';

interface User {
  id: string;
  email: string;
  cashBalance: number;
}

interface UserContextType {
  user: User | null;
  refreshUser: () => void;
}

const UserContext = createContext<UserContextType>({ user: null, refreshUser: () => {} });

export const useUser = () => useContext(UserContext);

export const UserProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);

  const fetchUser = () => {
    fetch(`${API_BASE}/me`)
      .then(res => res.json())
      .then(data => setUser({ ...data, cashBalance: Number(data.cashBalance) }))
      .catch(console.error);
  };

  useEffect(() => {
    fetchUser();
  }, []);

  return (
    <UserContext.Provider value={{ user, refreshUser: fetchUser }}>
      {children}
    </UserContext.Provider>
  );
};
