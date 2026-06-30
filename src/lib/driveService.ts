import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, User, signOut } from "firebase/auth";
import firebaseConfig from "../../firebase-applet-config.json";

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
export const auth = getAuth(app);

const provider = new GoogleAuthProvider();
provider.addScope("https://www.googleapis.com/auth/drive.file");

let isSigningIn = false;
let cachedAccessToken: string | null = null;

// Initialize auth state listener
export const initAuth = (
  onAuthSuccess?: (user: User, token: string) => void,
  onAuthFailure?: () => void
) => {
  return onAuthStateChanged(auth, async (user: User | null) => {
    if (user) {
      if (cachedAccessToken) {
        if (onAuthSuccess) onAuthSuccess(user, cachedAccessToken);
      } else {
        // If we have a user but no cached token (e.g. refreshed page),
        // we'll require the user to trigger signIn again to get a fresh access token
        if (onAuthFailure) onAuthFailure();
      }
    } else {
      cachedAccessToken = null;
      if (onAuthFailure) onAuthFailure();
    }
  });
};

// Google Sign-In pop-up
export const googleSignIn = async (): Promise<{ user: User; accessToken: string } | null> => {
  try {
    isSigningIn = true;
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error("Failed to get access token from Google Auth");
    }

    cachedAccessToken = credential.accessToken;
    return { user: result.user, accessToken: cachedAccessToken };
  } catch (error: any) {
    console.error("Sign in error:", error);
    throw error;
  } finally {
    isSigningIn = false;
  }
};

// Sign Out
export const googleSignOut = async () => {
  await signOut(auth);
  cachedAccessToken = null;
};

// Get the cached token
export const getAccessToken = (): string | null => {
  return cachedAccessToken;
};

// Types for Drive Files
export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  createdTime?: string;
  size?: string;
}

// Drive API Actions

// 1. List files matching DeepAsk Backup prefix
export const listDriveBackups = async (token: string): Promise<DriveFile[]> => {
  try {
    // We search for application/json files that contain "DeepAsk_Backup_" in name and are not trashed
    const q = encodeURIComponent("name contains 'DeepAsk_Backup_' and mimeType = 'application/json' and trashed = false");
    const url = `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,mimeType,createdTime,size)&orderBy=createdTime desc`;
    
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to list backups: ${response.statusText}`);
    }

    const data = await response.json();
    return data.files || [];
  } catch (error) {
    console.error("Error listing Drive backups:", error);
    throw error;
  }
};

// 2. Upload (create or update) backup file to Drive
export const uploadBackupToDrive = async (
  token: string,
  filename: string,
  treeDataJson: string
): Promise<DriveFile> => {
  try {
    // 1. Create metadata
    const metadataUrl = "https://www.googleapis.com/drive/v3/files";
    const metaResponse = await fetch(metadataUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: filename,
        mimeType: "application/json",
        description: "DeepAsk Mind Tree Backup",
      }),
    });

    if (!metaResponse.ok) {
      throw new Error(`Failed to create metadata: ${metaResponse.statusText}`);
    }

    const fileMeta = await metaResponse.json();
    const fileId = fileMeta.id;

    // 2. Upload media
    const uploadUrl = `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`;
    const uploadResponse = await fetch(uploadUrl, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: treeDataJson,
    });

    if (!uploadResponse.ok) {
      throw new Error(`Failed to upload file content: ${uploadResponse.statusText}`);
    }

    return await uploadResponse.json();
  } catch (error) {
    console.error("Error uploading backup to Drive:", error);
    throw error;
  }
};

// 3. Download backup content from Drive
export const downloadBackupFromDrive = async (token: string, fileId: string): Promise<any> => {
  try {
    const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to download backup: ${response.statusText}`);
    }

    const content = await response.json();
    return content;
  } catch (error) {
    console.error("Error downloading from Drive:", error);
    throw error;
  }
};

// 4. Delete backup file on Drive (Requires User Confirmation in UI beforehand)
export const deleteBackupFromDrive = async (token: string, fileId: string): Promise<boolean> => {
  try {
    const url = `https://www.googleapis.com/drive/v3/files/${fileId}`;
    const response = await fetch(url, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to delete backup: ${response.statusText}`);
    }

    return true;
  } catch (error) {
    console.error("Error deleting from Drive:", error);
    throw error;
  }
};
