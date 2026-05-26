import { initializeApp } from "firebase/app";
import { getDatabase } from "firebase/database";

const firebaseConfig = {
  apiKey: "AIzaSyCjhcpZgXJr-xXdciT4bcUvZ9ne0Jsc5gc",
  authDomain: "caro-cd3d1.firebaseapp.com",
  databaseURL: "https://caro-cd3d1-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "caro-cd3d1",
  storageBucket: "caro-cd3d1.firebasestorage.app",
  messagingSenderId: "779475833282",
  appId: "1:779475833282:web:f503223db8da8a40f4865b",
};

const app = initializeApp(firebaseConfig);

export const database = getDatabase(app);
