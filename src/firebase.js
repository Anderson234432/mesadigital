import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: "AIzaSyCZ8qGDsZNrijAkQVWvXtGRWelFc8FPkyM",
  authDomain: "mesadigital-d9b90.firebaseapp.com",
  projectId: "mesadigital-d9b90",
  storageBucket: "mesadigital-d9b90.firebasestorage.app",
  messagingSenderId: "66825226425",
  appId: "1:66825226425:web:5299f7098c2f4ffc58f368"
};

const app = initializeApp(firebaseConfig);
const secondaryApp = initializeApp(firebaseConfig, "Secondary");

export const db = getFirestore(app);
export const auth = getAuth(app);
export const secondaryAuth = getAuth(secondaryApp);
export const storage = getStorage(app);