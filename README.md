nodeca.convert
==============

[![Build Status](https://travis-ci.org/nodeca/nodeca.vbconvert.svg?branch=master)](https://travis-ci.org/nodeca/nodeca.vbconvert)

Convert forum database from vBulletin to Nodeca.

Installation
------------

1\. Install system-wide software, `build-essential` is needed to build binary modules and `software-properties-common` contains `apt-add-repository` utility:

```sh
sudo apt-get install build-essential software-properties-common
```

2\. Install `nodeca.vbconvert` module:

```sh
curl https://raw.githubusercontent.com/lovell/sharp/master/preinstall.sh | sudo sh
cd nodeca
npm i git+https://github.com/nodeca/nodeca.vbconvert.git
cp node_modules/nodeca.vbconvert/config/vbconvert.yml.example config/vbconvert.yml
```

3\. Install percona mysql version:

```sh
sudo apt-key adv --keyserver keys.gnupg.net --recv-keys 1C4CBDCDCD2EFD2A
echo "deb http://repo.percona.com/apt "$(lsb_release -sc)" main" | sudo tee /etc/apt/sources.list.d/percona.list
echo "deb-src http://repo.percona.com/apt "$(lsb_release -sc)" main" | sudo tee -a /etc/apt/sources.list.d/percona.list
sudo apt-get update
sudo apt-get install percona-server-server-5.6
```

4\. Prepare source images & database, reset mysql password:

```sh
mkdir /tmp/extract
lzop -d ./vzdump-openvz-101-*.tar.lzo -c | tar xv -C /tmp/extract
rm -rf /var/lib/mysql
cp -a /tmp/extract/var/lib/mysql /var/lib/mysql
chown mysql:mysql -Rv /var/lib/mysql
ln -s /tmp/extract/var/www/forum.rcdesign.ru/www /tmp/www
echo "FLUSH PRIVILEGES; SET PASSWORD FOR 'root'@'localhost' = '';" | mysql
```

Launch
------

```
./nodeca.js vbconvert
```
