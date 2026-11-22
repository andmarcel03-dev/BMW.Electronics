# BMW.Electronics

Sursă MGU Store cu aplicațiile alese de mine, copiate din repo-urile autorilor originali.

## Adăugare în MGU Store

În Store: **Settings → Add source** → `andmarcel03-dev/BMW.Electronics` → branch **main**.

## Aplicații incluse

| Aplicație | ID | Sursă | iDrive |
|---|---|---|---|
| BMW102 · Отключение xDrive (+ motor `bmw102-xdrive`) | `bmw102_xdrive` | [kargtx/MGU-BMW102](https://github.com/kargtx/MGU-BMW102) | 7 / 8 |
| BMW102 · Flash | `bmw102_flash` | [kargtx/MGU-BMW102](https://github.com/kargtx/MGU-BMW102) | 7 / 8 |
| BMW102 · Контакты | `bmw102_contacts` | [kargtx/MGU-BMW102](https://github.com/kargtx/MGU-BMW102) | 7 / 8 |
| Cluster Nav Card | `cluster_nav_card` | [SPRNV4/mgu-apps](https://github.com/SPRNV4/mgu-apps) | 7 |
| M Track Cluster | `adam_mtrack` | [pinguinooo/idrive7-apps](https://github.com/pinguinooo/idrive7-apps) | 7 |
| Shift Lights | `adam_shiftlights` | [pinguinooo/idrive7-apps](https://github.com/pinguinooo/idrive7-apps) | 7 |
| Engine Vitals | `adam_vitals` | [pinguinooo/idrive7-apps](https://github.com/pinguinooo/idrive7-apps) | 7 |

Dependențe externe: `bmw102-xdrive` cere `mgu-python`; BMW102 Flash cere GPU renderer și Controller gate din idrive7-apps; Cluster Nav Card cere Waze on cluster și cluster-render (idrive-apps); aplicațiile `adam_*` cer `idrive7-renderd` și `mgu-inputgate` (idrive7-apps).

## Cum funcționează

- `sources.json` — lista repo-urilor sursă. Opțional, `"include": ["id1", "id2"]` pe o sursă ca să iei doar unele aplicații.
- `tools/sync.py` — clonează sursele în `vendor/<nume>/` și generează `mgu-repo.json` la rădăcină.
- `.github/workflows/sync.yml` — rulează sincronizarea zilnic și la orice modificare a `sources.json`.
- `sources.lock.json` — commit-ul exact preluat din fiecare sursă.

Pentru o aplicație nouă: adaugă repo-ul în `sources.json` și dă commit; Action-ul face restul.

## Licențe

Fiecare aplicație rămâne a autorului ei, cu licența din folderul `vendor/<nume>/`.
