import { GoogleGenAI, Type } from "@google/genai";

// Use the API key from environment variables.
// In AI Studio, this is injected automatically.
// For self-deployment, set GEMINI_API_KEY in your environment variables.
const API_KEY = process.env.GEMINI_API_KEY || "";

if (!API_KEY || API_KEY === "MY_GEMINI_API_KEY") {
  console.error("GEMINI_API_KEY is not defined or is placeholder. Please check your environment configuration.");
} else {
  console.log("GEMINI_API_KEY detected successfully.");
}

const ai = new GoogleGenAI({ apiKey: API_KEY });

export interface Variation {
  question: string;
  answer: string;
  explanation: string;
}

export interface RecognitionResult {
  question: string;
  analysis: string;
  knowledgePoint: string;
}

export const geminiService = {
  async recognizeMistake(base64Image: string): Promise<RecognitionResult> {
    if (!API_KEY || API_KEY === "MY_GEMINI_API_KEY") {
      throw new Error("Missing Gemini API Key. Please set GEMINI_API_KEY in environment variables.");
    }

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: "image/jpeg",
              data: base64Image.split(',')[1] || base64Image,
            },
          },
          {
            text: `请识别图片中的错题内容。
            输出格式为 JSON，包含以下字段：
            - question: 题目文本内容
            - analysis: 对题目的简要分析
            - knowledgePoint: 题目的核心知识点（例如：“一元二次方程根的判别式”）`,
          },
        ],
      },
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            question: { type: Type.STRING },
            analysis: { type: Type.STRING },
            knowledgePoint: { type: Type.STRING },
          },
          required: ["question", "analysis", "knowledgePoint"],
        },
      },
    });

    try {
      return JSON.parse(response.text || "{}");
    } catch (e) {
      console.error("Failed to parse Gemini response", e);
      throw new Error("识别失败，请重试或手动输入。");
    }
  },

  async generateVariations(question: string, knowledgePoint: string): Promise<Variation[]> {
    if (!API_KEY || API_KEY === "MY_GEMINI_API_KEY") {
      throw new Error("Missing Gemini API Key. Please set GEMINI_API_KEY in environment variables.");
    }

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `基于以下错题内容和知识点，生成3道举一反三的变式题。
      
      原题：${question}
      知识点：${knowledgePoint}
      
      要求：
      1. 覆盖同一知识点的不同角度或变式。
      2. 难度与原题相当或略有梯度。
      3. 每道题附带正确答案。
      4. 每道题附带侧重易错点分析的解析（例如：“本题常见错误是……”）。
      
      输出格式为 JSON 数组，每个对象包含：
      - question: 变式题题目
      - answer: 答案
      - explanation: 解析（侧重易错点）`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              question: { type: Type.STRING },
              answer: { type: Type.STRING },
              explanation: { type: Type.STRING },
            },
            required: ["question", "answer", "explanation"],
          },
        },
      },
    });

    try {
      return JSON.parse(response.text || "[]");
    } catch (e) {
      console.error("Failed to parse variations response", e);
      throw new Error("生成变式题失败，请重试。");
    }
  },
};
