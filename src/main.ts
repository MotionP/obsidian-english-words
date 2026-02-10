import { App, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile } from "obsidian";
import * as https from "https";

// ── HTTPS helper (skip SSL verification for GigaChat) ───────

function httpsRequest(options: {
	url: string;
	method: string;
	headers: Record<string, string>;
	body?: string;
}): Promise<{ status: number; body: string }> {
	return new Promise((resolve, reject) => {
		const parsed = new URL(options.url);
		const req = https.request(
			{
				hostname: parsed.hostname,
				port: parsed.port || 443,
				path: parsed.pathname + parsed.search,
				method: options.method,
				headers: options.headers,
				rejectUnauthorized: false,
			},
			(res) => {
				const chunks: Buffer[] = [];
				res.on("data", (chunk: Buffer) => chunks.push(chunk));
				res.on("end", () => {
					resolve({
						status: res.statusCode || 0,
						body: Buffer.concat(chunks).toString("utf-8"),
					});
				});
			}
		);
		req.on("error", reject);
		if (options.body) {
			req.write(options.body);
		}
		req.end();
	});
}

// ── Settings ────────────────────────────────────────────────

interface EnglishWordsSettings {
	gigachatCredentials: string;
	filePath: string;
}

const DEFAULT_SETTINGS: EnglishWordsSettings = {
	gigachatCredentials: "",
	filePath: "English Words.md",
};

// ── GigaChat API ────────────────────────────────────────────

const OAUTH_URL = "https://ngw.devices.sberbank.ru:9443/api/v2/oauth";
const CHAT_URL = "https://gigachat.devices.sberbank.ru/api/v1/chat/completions";

const SYSTEM_PROMPT =
	"You are a linguistic assistant. " +
	"Your response must be structured as follows:\n" +
	"- **word**: the English word or a message indicating it's not an English word.\n" +
	"- **translation**: the Russian translation or a message indicating it's not an English word.\n" +
	"- **transcription**: IPA phonetic transcription or a message indicating it's not an English word.\n" +
	"- **pronunciation**: approximate Russian pronunciation hint or a message indicating it's not an English word.\n" +
	"- **examples**: 3 common everyday example sentences using the word. " +
	"Each example must have the sentence in English and its Russian translation. " +
	"Choose sentences that are frequently used in daily life.\n" +
	"If the input is not an English word, respond with 'This is not an English word.' for each field.\n\n" +
	"Reply ONLY with the structured data, no extra text. Use exactly this format:\n" +
	"word: <word>\n" +
	"translation: <translation>\n" +
	"transcription: <transcription>\n" +
	"pronunciation: <pronunciation>\n" +
	"example1_en: <sentence>\n" +
	"example1_ru: <translation>\n" +
	"example2_en: <sentence>\n" +
	"example2_ru: <translation>\n" +
	"example3_en: <sentence>\n" +
	"example3_ru: <translation>";

function generateUUID(): string {
	return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
		const r = (Math.random() * 16) | 0;
		const v = c === "x" ? r : (r & 0x3) | 0x8;
		return v.toString(16);
	});
}

async function getAccessToken(credentials: string): Promise<string> {
	const response = await httpsRequest({
		url: OAUTH_URL,
		method: "POST",
		headers: {
			"Content-Type": "application/x-www-form-urlencoded",
			Accept: "application/json",
			Authorization: `Basic ${credentials}`,
			RqUID: generateUUID(),
		},
		body: "scope=GIGACHAT_API_PERS",
	});

	const data = JSON.parse(response.body);
	if (!data.access_token) {
		throw new Error(`GigaChat auth failed: ${response.body}`);
	}
	return data.access_token;
}

interface WordResult {
	word: string;
	translation: string;
	transcription: string;
	pronunciation: string;
	example1_en: string;
	example1_ru: string;
	example2_en: string;
	example2_ru: string;
	example3_en: string;
	example3_ru: string;
}

function parseResponse(text: string): WordResult {
	const lines = text.split("\n");
	const result: Record<string, string> = {};

	for (const line of lines) {
		const colonIndex = line.indexOf(":");
		if (colonIndex === -1) continue;
		const key = line.substring(0, colonIndex).trim().toLowerCase();
		const value = line.substring(colonIndex + 1).trim();
		result[key] = value;
	}

	return {
		word: result["word"] || "",
		translation: result["translation"] || "",
		transcription: result["transcription"] || "",
		pronunciation: result["pronunciation"] || "",
		example1_en: result["example1_en"] || "",
		example1_ru: result["example1_ru"] || "",
		example2_en: result["example2_en"] || "",
		example2_ru: result["example2_ru"] || "",
		example3_en: result["example3_en"] || "",
		example3_ru: result["example3_ru"] || "",
	};
}

async function lookupWord(word: string, credentials: string): Promise<WordResult> {
	const token = await getAccessToken(credentials);

	const body = JSON.stringify({
		model: "GigaChat-Pro",
		temperature: 0.1,
		messages: [
			{ role: "system", content: SYSTEM_PROMPT },
			{
				role: "user",
				content: `Please provide the translation, IPA transcription, and Russian pronunciation hint for the English word: **${word}**. If it's not an English word, note that in your response.`,
			},
		],
	});

	const response = await httpsRequest({
		url: CHAT_URL,
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Accept: "application/json",
			Authorization: `Bearer ${token}`,
		},
		body,
	});

	const data = JSON.parse(response.body);
	const content = data.choices[0].message.content;
	return parseResponse(content);
}

function formatMarkdown(result: WordResult): string {
	let md = `\n## ${result.word}\n`;
	md += `- **Перевод:** ${result.translation}\n`;
	md += `- **Транскрипция:** ${result.transcription}\n`;
	md += `- **Произношение:** ${result.pronunciation}\n\n`;
	md += `**Примеры:**\n`;
	md += `1. ${result.example1_en}\n   ${result.example1_ru}\n`;
	md += `2. ${result.example2_en}\n   ${result.example2_ru}\n`;
	md += `3. ${result.example3_en}\n   ${result.example3_ru}\n\n`;
	md += `---\n`;
	return md;
}

// ── Modal ───────────────────────────────────────────────────

class WordInputModal extends Modal {
	plugin: EnglishWordsPlugin;

	constructor(app: App, plugin: EnglishWordsPlugin) {
		super(app);
		this.plugin = plugin;
	}

	onOpen() {
		const { contentEl } = this;

		contentEl.createEl("h2", { text: "Translate English Word" });

		const input = contentEl.createEl("input", {
			type: "text",
			placeholder: "Enter an English word...",
		});
		input.style.width = "100%";
		input.style.padding = "8px";
		input.style.marginBottom = "12px";

		const submitBtn = contentEl.createEl("button", {
			text: "Translate",
			cls: "mod-cta",
		});

		const onSubmit = async () => {
			const word = input.value.trim();
			if (!word) {
				new Notice("Please enter a word.");
				return;
			}

			if (!this.plugin.settings.gigachatCredentials) {
				new Notice("GigaChat credentials not set. Check plugin settings.");
				return;
			}

			this.close();
			new Notice(`Translating "${word}"...`);

			try {
				const result = await lookupWord(word, this.plugin.settings.gigachatCredentials);
				const markdown = formatMarkdown(result);
				await this.plugin.appendToFile(markdown);
				new Notice(`"${result.word}" saved to ${this.plugin.settings.filePath}`);
			} catch (e) {
				console.error("English Words plugin error:", e);
				new Notice(`Error: ${e instanceof Error ? e.message : String(e)}`);
			}
		};

		submitBtn.addEventListener("click", onSubmit);
		input.addEventListener("keydown", (e) => {
			if (e.key === "Enter") {
				onSubmit();
			}
		});

		input.focus();
	}

	onClose() {
		this.contentEl.empty();
	}
}

// ── Plugin ──────────────────────────────────────────────────

export default class EnglishWordsPlugin extends Plugin {
	settings: EnglishWordsSettings = DEFAULT_SETTINGS;

	async onload() {
		await this.loadSettings();

		this.addCommand({
			id: "english-words-lookup",
			name: "Translate English word",
			callback: () => {
				new WordInputModal(this.app, this).open();
			},
		});

		this.addSettingTab(new EnglishWordsSettingTab(this.app, this));
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	async appendToFile(content: string) {
		const filePath = this.settings.filePath;
		const file = this.app.vault.getAbstractFileByPath(filePath);

		if (file instanceof TFile) {
			const existing = await this.app.vault.read(file);
			await this.app.vault.modify(file, existing + content);
		} else {
			await this.app.vault.create(filePath, `# English Words\n${content}`);
		}
	}
}

// ── Settings Tab ────────────────────────────────────────────

class EnglishWordsSettingTab extends PluginSettingTab {
	plugin: EnglishWordsPlugin;

	constructor(app: App, plugin: EnglishWordsPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("GigaChat Credentials")
			.setDesc("Authorization key from developers.sber.ru (base64)")
			.addText((text) =>
				text
					.setPlaceholder("Enter your credentials")
					.setValue(this.plugin.settings.gigachatCredentials)
					.onChange(async (value) => {
						this.plugin.settings.gigachatCredentials = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Dictionary file path")
			.setDesc("Path to the file in vault where words will be saved")
			.addText((text) =>
				text
					.setPlaceholder("English Words.md")
					.setValue(this.plugin.settings.filePath)
					.onChange(async (value) => {
						this.plugin.settings.filePath = value;
						await this.plugin.saveSettings();
					})
			);
	}
}
