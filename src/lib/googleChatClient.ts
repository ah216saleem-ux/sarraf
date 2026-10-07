/**
 * Google Chat API Client Library (Client-Side & Server-Proxying)
 * Integrates official Google Chat v1 REST endpoints with bearer token auth.
 */

export interface GoogleChatSpace {
  name: string; // e.g., 'spaces/AAAABBBCCCDDD'
  displayName?: string;
  type?: 'SPACE' | 'GROUP_CHAT' | 'DIRECT_MESSAGE';
  spaceType?: 'SPACE' | 'GROUP_CHAT' | 'DIRECT_MESSAGE';
  spaceThreadingState?: string;
  externalUserAllowed?: boolean;
}

export interface GoogleChatMessage {
  name: string; // 'spaces/XXX/messages/YYY'
  text?: string;
  formattedText?: string;
  createTime: string;
  sender?: {
    name: string;
    displayName: string;
    avatarUrl?: string;
    type: 'HUMAN' | 'BOT';
  };
  cardsV2?: Array<{
    cardId: string;
    card: {
      header?: {
        title: string;
        subtitle?: string;
        imageUrl?: string;
        imageType?: string;
      };
      sections?: Array<{
        header?: string;
        widgets: Array<any>;
      }>;
    };
  }>;
}

export interface SetupPreReviewPayload {
  signalId: string;
  direction: 'BUY' | 'SELL';
  entry: number;
  sl: number;
  tp1: number;
  tp2: number;
  tp3: number;
  tp4: number;
  score: number;
  bias: { d1: string; h4: string; h1: string };
  reason: string;
  timestamp: string;
}

export async function fetchGoogleChatSpaces(token: string): Promise<GoogleChatSpace[]> {
  const res = await fetch('https://chat.googleapis.com/v1/spaces', {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error?.message || `Google Chat API Error: ${res.status}`);
  }

  const data = await res.json();
  return data.spaces || [];
}

export async function createGoogleChatSpace(
  token: string,
  displayName: string
): Promise<GoogleChatSpace> {
  const res = await fetch('https://chat.googleapis.com/v1/spaces', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      displayName,
      spaceType: 'SPACE',
    }),
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error?.message || `Failed to create Google Chat space: ${res.status}`);
  }

  return await res.json();
}

export async function fetchSpaceMessages(
  token: string,
  spaceName: string
): Promise<GoogleChatMessage[]> {
  const encodedSpace = encodeURI(spaceName);
  const res = await fetch(`https://chat.googleapis.com/v1/${encodedSpace}/messages?pageSize=30`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error?.message || `Failed to fetch messages: ${res.status}`);
  }

  const data = await res.json();
  return data.messages || [];
}

export async function sendSpaceMessage(
  token: string,
  spaceName: string,
  text: string,
  cardsV2?: any[]
): Promise<GoogleChatMessage> {
  const encodedSpace = encodeURI(spaceName);
  const bodyPayload: Record<string, any> = { text };
  if (cardsV2) {
    bodyPayload.cardsV2 = cardsV2;
  }

  const res = await fetch(`https://chat.googleapis.com/v1/${encodedSpace}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(bodyPayload),
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error?.message || `Failed to send message: ${res.status}`);
  }

  return await res.json();
}

/**
 * Builds an institutional SARRAF card for Google Chat
 */
export function buildSetupReviewCard(setup: SetupPreReviewPayload) {
  const isBuy = setup.direction === 'BUY';
  const dirIcon = isBuy ? '🟢' : '🔴';
  
  return [
    {
      cardId: `setup_${setup.signalId}`,
      card: {
        header: {
          title: `SARRAF Institutional Setup Pre-Review: ${setup.signalId}`,
          subtitle: `XAUUSD Spot ${setup.direction} Setup | Score ${setup.score}/100`,
          imageUrl: 'https://fonts.gstatic.com/s/i/short-term/release/googlegsymbol/finance/default/24px.svg',
          imageType: 'CIRCLE',
        },
        sections: [
          {
            header: 'Execution Plan & Parameters',
            widgets: [
              {
                decoratedText: {
                  topLabel: 'Order Plan',
                  text: `<b>${dirIcon} ${setup.direction} LIMIT: $${setup.entry.toFixed(2)}</b>`,
                  bottomLabel: `Fixed SL: $${setup.sl.toFixed(2)} (-$10.00 Risk)`,
                },
              },
              {
                decoratedText: {
                  topLabel: 'Target Objectives (Conservative Institutional Scaling)',
                  text: `TP1: $${setup.tp1.toFixed(2)} | TP2: $${setup.tp2.toFixed(2)} | TP3: $${setup.tp3.toFixed(2)} | TP4: $${setup.tp4.toFixed(2)}`,
                },
              },
              {
                decoratedText: {
                  topLabel: 'Timeframe Alignment Matrix',
                  text: `D1: <b>${setup.bias.d1}</b> | H4: <b>${setup.bias.h4}</b> | H1: <b>${setup.bias.h1}</b>`,
                },
              },
              {
                decoratedText: {
                  topLabel: 'AI Assessment & Confluence',
                  text: setup.reason,
                  wrapText: true,
                },
              },
            ],
          },
        ],
      },
    },
  ];
}
