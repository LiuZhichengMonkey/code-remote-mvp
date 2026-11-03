#ifndef TORRENT_CORE_H
#define TORRENT_CORE_H
#include <stdint.h>
int TorrentStart(char *path, char *token);
void TorrentStop(void);
int TorrentProgress(int64_t *done, int64_t *total);
#endif
