import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyCZ8qGDsZNrijAkQVWvXtGRWelFc8FPkyM",
  authDomain: "mesadigital-d9b90.firebaseapp.com",
  projectId: "mesadigital-d9b90",
  storageBucket: "mesadigital-d9b90.firebasestorage.app",
  messagingSenderId: "66825226425",
  appId: "1:66825226425:web:5299f7098c2f4ffc58f368"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);