import type { Moment } from "moment";
import { App, normalizePath, Notice, TFile, TFolder, Vault } from "obsidian";

import { getDateFromFile, getDateUID } from "./parse";
import { getDailyNoteSettings } from "./settings";
import { getTemplateInfo, getNotePath } from "./vault";

export class DailyNotesFolderMissingError extends Error {}

export interface CreateDailyNoteOptions {
  /**
   * Overrides the note name format (Moment format string).
   */
  noteNameFormat?: string;
  /**
   * Overrides the folder path using a Moment format string.
   *
   * Example: `Calendar/YYYY/MMMM/` -> `Calendar/2026/March/`
   */
  folderPathFormat?: string;
}

/**
 * This function mimics the behavior of the daily-notes plugin
 * so it will replace {{date}}, {{title}}, and {{time}} with the
 * formatted timestamp.
 *
 * Note: it has an added bonus that it's not 'today' specific.
 */
export async function createDailyNote(
  date: Moment,
  options: CreateDailyNoteOptions = {}
): Promise<TFile> {
  const app = window.app as App;
  const { vault } = app;
  const moment = window.moment;

  const settings = getDailyNoteSettings();
  const template = settings.template;
  const format = options.noteNameFormat ?? settings.format ?? "YYYY-MM-DD";
  const folder = settings.folder ?? "";

  const [templateContents, IFoldInfo] = await getTemplateInfo(template);
  const filename = date.format(format);

  const folderPathFormat = options.folderPathFormat?.trim();
  const normalizedPath = await (folderPathFormat
    ? getNotePath(date.format(folderPathFormat), filename)
    : getNotePath(folder, filename));

  try {
    const createdFile = await vault.create(
      normalizedPath,
      templateContents
        .replace(/{{\s*date\s*}}/gi, filename)
        .replace(/{{\s*time\s*}}/gi, moment().format("HH:mm"))
        .replace(/{{\s*title\s*}}/gi, filename)
        .replace(
          /{{\s*(date|time)\s*(([+-]\d+)([yqmwdhs]))?\s*(:.+?)?}}/gi,
          (_, _timeOrDate, calc, timeDelta, unit, momentFormat) => {
            const now = moment();
            const currentDate = date.clone().set({
              hour: now.get("hour"),
              minute: now.get("minute"),
              second: now.get("second"),
            });
            if (calc) {
              currentDate.add(parseInt(timeDelta, 10), unit);
            }

            if (momentFormat) {
              return currentDate.format(momentFormat.substring(1).trim());
            }
            return currentDate.format(format);
          }
        )
        .replace(
          /{{\s*yesterday\s*}}/gi,
          date.clone().subtract(1, "day").format(format)
        )
        .replace(
          /{{\s*tomorrow\s*}}/gi,
          date.clone().add(1, "d").format(format)
        )
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (app as any).foldManager.save(createdFile, IFoldInfo);

    return createdFile;
  } catch (err) {
    console.error(`Failed to create file: '${normalizedPath}'`, err);
    new Notice("Unable to create new file.");
  }
}

export function getDailyNote(
  date: Moment,
  dailyNotes: Record<string, TFile>
): TFile {
  return dailyNotes[getDateUID(date, "day")] ?? null;
}

export function getAllDailyNotes(): Record<string, TFile> {
  /**
   * Find all daily notes in the daily note folder
   */
  const { vault } = window.app;
  const { folder } = getDailyNoteSettings();

  const dailyNotesFolder = vault.getAbstractFileByPath(
    normalizePath(folder)
  ) as TFolder;

  if (!dailyNotesFolder) {
    throw new DailyNotesFolderMissingError("Failed to find daily notes folder");
  }

  const dailyNotes: Record<string, TFile> = {};
  Vault.recurseChildren(dailyNotesFolder, (note) => {
    if (note instanceof TFile) {
      const date = getDateFromFile(note, "day");
      if (date) {
        const dateString = getDateUID(date, "day");
        dailyNotes[dateString] = note;
      }
    }
  });

  return dailyNotes;
}
