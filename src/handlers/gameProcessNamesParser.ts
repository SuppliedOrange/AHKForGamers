import fs from "fs";
import { getGameListPath } from "../utils/paths";

/**
 * Get the list of illegal game process names from the bundled text file.
 * [OBSOLETE]
 * 
 * @returns An array of the illegal game process names.
 */
export default function getGameProcessNames(): string[] {

	// Resolve game list path

	const filePath = getGameListPath();

	const raw = fs.readFileSync(filePath, "utf-8");

	return raw
		.split(/\r?\n/)
		.map(line => line.trim())
		.filter(line => line.length > 0 && !line.startsWith("#"));

}