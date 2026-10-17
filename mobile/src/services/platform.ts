import Constants, { ExecutionEnvironment } from "expo-constants";
import { Platform } from "react-native";

/** Running inside Expo Go (no custom native code, no background location). */
export const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
export const isWeb = Platform.OS === "web";
