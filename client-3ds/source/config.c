#include "config.h"

#include <errno.h>
#include <stdio.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

#define TMP_PATH CONFIG_PATH ".tmp"
#define BAK_PATH CONFIG_PATH ".bak"

static int read_file(const char *path, Config *c) {
  FILE *f = fopen(path, "rb");
  if (f == NULL) return 0;
  char buf[CONFIG_MAX_FILE + 1];
  size_t n = fread(buf, 1, sizeof buf, f);
  fclose(f);
  config_parse(buf, n, c);
  return 1;
}

int config_load(Config *c) {
  config_defaults(c);
  if (read_file(CONFIG_PATH, c)) return 1;
  if (read_file(BAK_PATH, c)) return 1; // se cortó entre quitar el archivo y renombrar el nuevo
  return 0;
}

static void make_dirs(void) {
  mkdir("sdmc:/3ds", 0777);
  mkdir(CONFIG_DIR, 0777);
}

int config_save(const Config *c) {
  char buf[CONFIG_MAX_FILE];
  int n = config_serialize(c, buf, sizeof buf);
  if (n < 0) return -1;
  make_dirs();

  FILE *f = fopen(TMP_PATH, "wb");
  if (f == NULL) return -1;
  size_t w = fwrite(buf, 1, (size_t)n, f);
  int closed = fclose(f);
  if (w != (size_t)n || closed != 0) {
    remove(TMP_PATH);
    return -1;
  }

  // En FAT no se puede renombrar sobre un archivo existente: el anterior pasa a .bak mientras tanto.
  remove(BAK_PATH);
  int had_old = rename(CONFIG_PATH, BAK_PATH) == 0;
  if (rename(TMP_PATH, CONFIG_PATH) != 0) {
    if (had_old) rename(BAK_PATH, CONFIG_PATH);
    remove(TMP_PATH);
    return -1;
  }
  if (had_old) remove(BAK_PATH);
  return 0;
}
