Import old forum data
=====================

Pre-install
-----------

- Make sure `rcd-nodeca` installed & configured
- Install tools if needed `sudo apt-get install build-essential software-properties-common`.

Install percona mysql server:

```sh
sudo apt-key adv --keyserver keys.gnupg.net --recv-keys 1C4CBDCDCD2EFD2A
echo "deb http://repo.percona.com/apt "$(lsb_release -sc)" main" | sudo tee /etc/apt/sources.list.d/percona.list
echo "deb-src http://repo.percona.com/apt "$(lsb_release -sc)" main" | sudo tee -a /etc/apt/sources.list.d/percona.list
sudo apt-get update
sudo apt-get install percona-server-server-5.6
```


Prepare data
------------

Unpack:

```sh
mkdir /tmp/extract
lzop -d ./vzdump-openvz-101-*.tar.lzo -c | tar xv -C /tmp/extract
service mysql stop
# Check mysql does not run and kill if needed
ps ax | grep mysql
kill `cat /var/run/mysqld/mysqld.pid`
rm -rf /var/lib/mysql
cp -a /tmp/extract/var/lib/mysql /var/lib/mysql
chown mysql:mysql -Rv /var/lib/mysql
ln -s /tmp/extract/var/www/forum.rcdesign.ru/www /tmp/www
# Leave empty password field when asked, we reset it in next step
dpkg-reconfigure percona-server-server-5.6
```

Reset mysql permissions:

```sh
service mysql stop
mysqld_safe --skip-grant-tables &
echo "UPDATE mysql.user SET plugin = '' WHERE plugin = 'mysql_old_password'; FLUSH PRIVILEGES;" | mysql
echo "FLUSH PRIVILEGES; SET PASSWORD FOR 'root'@'localhost' = '';" | mysql
kill `cat /var/run/mysqld/mysqld.pid`
service mysql start
```


Import, part 1 (CLI)
--------------------

Drop old content (dev server only):

```sh
mongo nodeca --eval "printjson(db.dropDatabase())"
mongo nodeca-files --eval "printjson(db.dropDatabase())"
redis-cli -n 0 flushdb
```

Run CLI importer

```sh
./server.js migrate --all
./server.js vbconvert
```

Restore cached links/images data:

```sh
./bin/db-restore-cache nodeca ../dump_cache/nodeca
```

Start server:

```sh
start nodeca
service nginx start
```


Import, part 2 (admin panel)
----------------------------

1. Vbconvert -> Import BBcode -> Forum Posts
2. Vbconvert -> Import BBcode -> Messages
3. Core -> Rebuild -> Posts
4. Core -> Rebuild -> Topics
5. Core -> Rebuild -> Messages
6. Core -> Rebuild -> External links
7. Core -> Rebuild -> Images info
8. Core -> Rebuild -> Posts
9. Core -> NNTP -> Rebuild all
10. Core -> Dashboard -> Online
11. Core -> Rebuild -> Messages
12. Core -> Search -> Reindex
